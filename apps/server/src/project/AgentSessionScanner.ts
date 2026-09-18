/**
 * AgentSessionScanner - discovery of projects a user already works on.
 *
 * Claude Code and Codex both keep a per-session transcript on disk, and each
 * transcript records the directory the session ran in. Reading those `cwd`
 * values gives us the set of directories worth offering as projects during
 * onboarding, without asking the user to browse the filesystem.
 *
 * The scan is read-only and best-effort: an unreadable home, a malformed
 * transcript, or a directory that has since been deleted is skipped rather
 * than failing the scan. Project creation stays with the client, which
 * dispatches `project.create` for whichever candidates the user picks.
 *
 * @module project/AgentSessionScanner
 */
import * as NodeOS from "node:os";

import {
  AgentSessionScanError,
  ClaudeSettings,
  CodexSettings,
  ProviderDriverKind,
  importedAgentSessionThreadId,
  ProviderInstanceId,
  resolveProviderInstanceEnabled,
  type AgentSessionImportSource,
  type AgentSessionProjectCandidate,
  type AgentSessionProjectGit,
  type AgentSessionScanResult,
  type AgentSessionThreadSummary,
  type AgentSessionThreadsResult,
  type ProviderInstanceConfig,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import {
  normalizeGitRemoteUrl,
  parseGitHubRepositoryNameWithOwnerFromRemoteUrl,
  parseOriginUrlFromGitConfig,
} from "@t3tools/shared/git";
import { HostProcessEnvironment, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { normalizeProjectPathForComparison } from "@t3tools/shared/path";

import * as ServerConfig from "../config.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { resolveCodexHomeLayout } from "../provider/Drivers/CodexHomeLayout.ts";
import { expandHomePath } from "../pathExpansion.ts";
import * as ServerSettings from "../serverSettings.ts";
/** Small reads avoid wasting the metadata budget on long Codex instruction headers. */
const METADATA_READ_BYTES = 8 * 1024;
/** Prevent malformed transcripts from turning project discovery into a full file scan. */
const MAX_TRANSCRIPT_SCAN_BYTES = 1024 * 1024;

/**
 * Upper bound on transcripts inspected (first line read) per source.
 * Newest-first ordering means the cap drops only stale sessions when a home
 * directory is unusually large.
 */
const MAX_TRANSCRIPTS_PER_SOURCE = 5000;

/**
 * Upper bound on discovery filesystem operations per source. Newest-first
 * ordering needs mtimes before the read cap can be applied, so directory reads
 * and candidate stats share a larger budget. Once it runs out the scan stops.
 */
const MAX_DISCOVERY_OPERATIONS_PER_SOURCE = MAX_TRANSCRIPTS_PER_SOURCE * 4;
const MAX_METADATA_BYTES_PER_SOURCE = 64 * 1024 * 1024;
const MAX_METADATA_OPERATIONS_PER_SOURCE = MAX_TRANSCRIPTS_PER_SOURCE * 4;
const MAX_METADATA_RECORDS_PER_SOURCE = 100_000;
const MAX_METADATA_RECORDS_PER_TRANSCRIPT = 1_000;
const RECENT_THREAD_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How many conversations one listing offers. Past this the list stops being a
 * list somebody reads and starts being a second search problem, and every entry
 * costs a transcript read. The cut is reported rather than hidden.
 */
const MAX_LISTED_THREADS = 50;

/** First-user-message preview, long enough to recognize a conversation by. */
const THREAD_PREVIEW_CHARS = 240;

/**
 * How recently a transcript must have been written to count as a session that
 * is still running.
 *
 * Resuming a running session puts a second writer on the one file that holds
 * the conversation, so the listing shows it and declines to offer it. Nothing
 * on disk says "this process is alive", so this is a judgement: an agent writes
 * a record on every tool call and every message, and five minutes is longer
 * than any gap between those and shorter than any session somebody has really
 * finished with. Measured on this author's own machine, a two-minute window
 * called a session that was mid-work "quiet" — the gap between two of its tool
 * calls was 155 seconds.
 */
export const STILL_WRITING_WINDOW_MS = 5 * 60 * 1000;

/**
 * Large tool results (especially screenshots) can make an otherwise ordinary
 * Codex transcript several GiB. Raw I/O and retained history have separate
 * budgets.
 */
const MAX_IMPORTED_TRANSCRIPT_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_IMPORTED_MESSAGES = 200;
const MAX_IMPORT_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_IMPORT_TRANSCRIPTS = 100;
const MAX_IMPORT_RECORDS = 100_000;

/**
 * A conversation's last messages are at the END of its transcript, so that is
 * where the import reads from.
 *
 * Reading forwards meant holding the selected history of the whole file, and a
 * real session is not small: 420 MB and 171 MB on this author's own machine,
 * both refused with "selected history exceeds the 32 MiB memory budget" — which
 * is to say the sessions somebody most wants back are exactly the ones that
 * could not come back. The last 200 records of either file are about 0.4 MB.
 *
 * So the budget is on what is READ, never on what the file holds. The provider
 * session id resumes the conversation in full regardless of how much of it T3
 * shows, which is what makes showing a tail honest rather than lossy.
 */
const TAIL_CHUNK_BYTES = 256 * 1024;
const MAX_TAIL_SCAN_BYTES = 16 * 1024 * 1024;
/**
 * The most one record may occupy while its line is assembled. A single tool
 * result can be a screenshot or a whole file; past this its bytes are dropped
 * instead of held, so it hides the messages around it rather than the session.
 */
const MAX_RECORD_BUFFER_BYTES = 8 * 1024 * 1024;
/** Records examined while walking backwards, before message filtering. */
const MAX_TAIL_RECORDS = 50_000;
/** Bytes read from the start of a tailed transcript for what only its head knows. */
const MAX_HEAD_SCAN_BYTES = 4 * 1024 * 1024;
/**
 * Bytes read backwards when a transcript's head never named its directory.
 * A session continued after compaction starts with `history-suppression`,
 * `ai-title`, `agent-name`, `mode` and `permission-mode` records and no `cwd`:
 * in one real transcript the first `cwd` sat at byte 952,129, 96 KB inside the
 * forward budget, so a slightly longer summary would have dropped the session
 * from the scan entirely. Claude writes `cwd` on every record, so the end of
 * the file answers in one read what the start may not answer at all.
 */
const MAX_CWD_TAIL_SCAN_BYTES = 256 * 1024;

const TranscriptContentBlock = Schema.Struct({
  type: Schema.optional(Schema.String),
  text: Schema.optional(Schema.String),
});

const TranscriptMessage = Schema.Struct({
  role: Schema.optional(Schema.String),
  content: Schema.optional(Schema.Union([Schema.String, Schema.Array(TranscriptContentBlock)])),
  model: Schema.optional(Schema.String),
});

const CodexTurnMetadata = Schema.Struct({
  turn_id: Schema.optional(Schema.Union([Schema.String, Schema.Null])),
});

const TranscriptRecord = Schema.Struct({
  type: Schema.optional(Schema.String),
  timestamp: Schema.optional(Schema.String),
  cwd: Schema.optional(Schema.String),
  sessionId: Schema.optional(Schema.String),
  aiTitle: Schema.optional(Schema.String),
  isSidechain: Schema.optional(Schema.Boolean),
  isMeta: Schema.optional(Schema.Boolean),
  isCompactSummary: Schema.optional(Schema.Boolean),
  message: Schema.optional(TranscriptMessage),
  payload: Schema.optional(
    Schema.Struct({
      id: Schema.optional(Schema.String),
      session_id: Schema.optional(Schema.String),
      type: Schema.optional(Schema.String),
      role: Schema.optional(Schema.String),
      message: Schema.optional(Schema.String),
      model: Schema.optional(Schema.String),
      cwd: Schema.optional(Schema.String),
      content: Schema.optional(Schema.Array(TranscriptContentBlock)),
      internal_chat_message_metadata_passthrough: Schema.optional(Schema.Unknown),
    }),
  ),
});

const decodeClaudeSettings = Schema.decodeUnknownOption(ClaudeSettings);
const decodeCodexSettings = Schema.decodeUnknownOption(CodexSettings);
const decodeTranscriptRecord = Schema.decodeUnknownOption(Schema.fromJsonString(TranscriptRecord));
const decodeCodexTurnMetadata = Schema.decodeUnknownOption(CodexTurnMetadata);

type DecodedTranscriptRecord = typeof TranscriptRecord.Type;

interface AgentSessionTranscriptMetadata {
  readonly source: AgentSessionSource;
  readonly providerInstanceId: ProviderInstanceId;
  readonly fallbackSessionId: string;
  readonly lastActiveAtMs: number;
  /** The records are the end of a longer conversation, not all of it. */
  readonly historyTruncated?: boolean;
}

export interface AgentSessionThreadMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly createdAt: string;
}

export interface AgentSessionThread {
  readonly source: AgentSessionSource;
  readonly providerInstanceId: ProviderInstanceId;
  readonly providerSessionId: string;
  readonly title: string;
  readonly model: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly messages: ReadonlyArray<AgentSessionThreadMessage>;
  /**
   * These messages are the end of a longer conversation. The provider session
   * still resumes it in full — the import says so rather than leaving the user
   * to wonder what the agent remembers.
   */
  readonly historyTruncated: boolean;
}

export type AgentSessionRecentThread =
  | {
      readonly _tag: "Importable";
      readonly thread: AgentSessionThread;
      readonly source: AgentSessionImportSource;
      /** Resolved directory the transcript recorded, for listings across projects. */
      readonly workspaceRoot: string;
    }
  | { readonly _tag: "AlreadyImported"; readonly source: AgentSessionImportSource }
  | { readonly _tag: "Duplicate"; readonly source: AgentSessionImportSource }
  | { readonly _tag: "Skipped" };

/** Service tag for agent session discovery. */
export class AgentSessionScanner extends Context.Service<
  AgentSessionScanner,
  {
    /**
     * Discover every directory the configured Claude and Codex homes have run
     * a session in. Candidates are returned newest-first; the client decides
     * which ones to import and how far back to look. Fails with the contract
     * error directly — there is no server-local context worth wrapping.
     */
    readonly scan: Effect.Effect<AgentSessionScanResult, AgentSessionScanError>;
    readonly recentThreads: (
      workspaceRoot: string,
      completedSources?: ReadonlyArray<AgentSessionImportSource>,
    ) => Stream.Stream<AgentSessionRecentThread, AgentSessionScanError>;
    /**
     * The same recent transcripts, described rather than imported: one entry per
     * conversation with the directory it ran in, the account that ran it, when
     * it was last touched and how big it is. Without a `workspaceRoot` it spans
     * every project on this machine, which is what somebody looking for a
     * session they remember needs — they remember the conversation, not the
     * folder.
     */
    readonly recentThreadSummaries: (options?: {
      readonly workspaceRoot?: string | undefined;
    }) => Effect.Effect<AgentSessionThreadsResult, AgentSessionScanError>;
  }
>()("t3/project/AgentSessionScanner") {}

type AgentSessionSource = AgentSessionProjectCandidate["sources"][number];

/** A single directory's worth of evidence from one source. */
interface RawCandidate {
  readonly cwd: string;
  readonly source: AgentSessionSource;
  readonly providerInstanceId: ProviderInstanceId;
  readonly threadCount: number;
  readonly lastActiveAtMs: number | null;
  readonly transcripts: ReadonlyArray<{
    readonly filePath: string;
    readonly mtimeMs: number | null;
  }>;
}

interface TranscriptCandidate {
  readonly filePath: string;
  readonly mtimeMs: number;
  readonly providerInstanceId: ProviderInstanceId;
  readonly size: number;
}

interface MetadataReadBudget {
  bytesRemaining: number;
  operationsRemaining: number;
  recordsRemaining: number;
  truncated: boolean;
}

function selectMetadataTranscripts(transcripts: ReadonlyArray<TranscriptCandidate>) {
  const selected: Array<TranscriptCandidate> = [];
  let pending = Array.from(
    Map.groupBy(transcripts, (transcript) => transcript.providerInstanceId).values(),
    (entries) => entries.values(),
  );
  while (pending.length > 0 && selected.length < MAX_TRANSCRIPTS_PER_SOURCE) {
    const nextRound: typeof pending = [];
    for (const iterator of pending) {
      if (selected.length === MAX_TRANSCRIPTS_PER_SOURCE) break;
      const next = iterator.next();
      if (next.done) continue;
      selected.push(next.value);
      nextRound.push(iterator);
    }
    pending = nextRound;
  }
  return selected;
}

function splitTranscriptRecords(contents: string, limit: number): string[] {
  const records = contents.endsWith("\n") ? contents.slice(0, -1) : contents;
  return records.split("\n", limit);
}

function extractText(
  content: string | ReadonlyArray<typeof TranscriptContentBlock.Type> | undefined,
): string {
  if (typeof content === "string") return content.trim();
  if (content === undefined) return "";
  return content
    .filter(
      (block) =>
        block.type === "text" || block.type === "input_text" || block.type === "output_text",
    )
    .map((block) => block.text?.trim() ?? "")
    .filter((text) => text.length > 0)
    .join("\n");
}

function normalizeTimestamp(value: string | undefined, fallback: string): string {
  if (value === undefined) return fallback;
  const parsed = DateTime.make(value);
  return Option.isSome(parsed) ? DateTime.formatIso(parsed.value) : fallback;
}

function codexTurnId(metadata: unknown): string | null {
  const decoded = decodeCodexTurnMetadata(metadata);
  if (
    Option.isNone(decoded) ||
    typeof decoded.value.turn_id !== "string" ||
    decoded.value.turn_id.trim().length === 0
  ) {
    return null;
  }
  return decoded.value.turn_id;
}

/** Keep visible user and assistant text while ignoring tools, reasoning, and malformed records. */
export function parseAgentSessionTranscript(
  input: AgentSessionTranscriptMetadata & {
    readonly contents: string;
  },
  lines = splitTranscriptRecords(input.contents, MAX_IMPORT_RECORDS + 1),
): AgentSessionThread | null {
  if (lines.length > MAX_IMPORT_RECORDS) return null;
  const records = lines.flatMap((line) => Option.toArray(decodeTranscriptRecord(line)));
  return parseAgentSessionRecords(input, records);
}

function parseAgentSessionRecords(
  input: AgentSessionTranscriptMetadata,
  records: ReadonlyArray<DecodedTranscriptRecord>,
): AgentSessionThread | null {
  const fallbackTimestamp = DateTime.formatIso(DateTime.makeUnsafe(input.lastActiveAtMs));
  // Claude filenames are session IDs. Codex rollout filenames include extra
  // timestamp text, so only transcript metadata can provide a resumable ID.
  let providerSessionId = input.source === "codex" ? "" : input.fallbackSessionId;
  let title: string | null = null;
  let model: string | null = null;
  let hasCodexSessionId = false;
  const messages: Array<AgentSessionThreadMessage & { readonly codexResponseUser: boolean }> = [];
  let firstUserMessage:
    | (AgentSessionThreadMessage & { readonly codexResponseUser: boolean })
    | undefined;
  // A Codex response item can include generated setup text beside the real
  // prompt. Suppress response-user records only when the shared turn ID and a
  // verbatim event copy prove which prompt the user submitted.
  const canonicalCodexResponseUserIndices = new Set<number>();
  let canonicalUserTextsInTurn = new Set<string>();
  let responseUsersInTurn: Array<{
    readonly index: number;
    readonly turnId: string;
    readonly text: string;
  }> = [];
  const finishCodexTurn = () => {
    const canonicalTurnIds = new Set(
      responseUsersInTurn.flatMap((responseUser) =>
        canonicalUserTextsInTurn.has(responseUser.text) ? [responseUser.turnId] : [],
      ),
    );
    for (const responseUser of responseUsersInTurn) {
      if (canonicalTurnIds.has(responseUser.turnId)) {
        canonicalCodexResponseUserIndices.add(responseUser.index);
      }
    }
    canonicalUserTextsInTurn = new Set();
    responseUsersInTurn = [];
  };
  if (input.source === "codex") {
    let recordIndex = -1;
    for (const record of records) {
      recordIndex += 1;
      if (
        record.type === "response_item" &&
        record.payload?.type === "message" &&
        record.payload.role === "assistant"
      ) {
        finishCodexTurn();
        continue;
      }
      if (record.type === "event_msg" && record.payload?.type === "user_message") {
        const text = record.payload.message?.trim() ?? "";
        if (text.length > 0) canonicalUserTextsInTurn.add(text);
        continue;
      }
      if (
        record.type === "response_item" &&
        record.payload?.type === "message" &&
        record.payload.role === "user"
      ) {
        const turnId = codexTurnId(record.payload.internal_chat_message_metadata_passthrough);
        const text = extractText(record.payload.content);
        if (turnId !== null && text.length > 0) {
          responseUsersInTurn.push({ index: recordIndex, turnId, text });
        }
      }
    }
    finishCodexTurn();
  }

  const retainMessage = (
    message: AgentSessionThreadMessage & { readonly codexResponseUser: boolean },
  ) => {
    if (firstUserMessage === undefined && message.role === "user") {
      firstUserMessage = message;
    }
    messages.push(message);
    if (messages.length > MAX_IMPORTED_MESSAGES) messages.shift();
  };

  const hasMatchingCodexEventInTurn = (text: string) => {
    const comparisonText = text.trim();
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index];
      if (message?.role === "assistant") return false;
      if (
        message?.role === "user" &&
        !message.codexResponseUser &&
        message.text.trim() === comparisonText
      ) {
        return true;
      }
    }
    return false;
  };

  let recordIndex = -1;
  for (const record of records) {
    recordIndex += 1;
    if (input.source === "claudeAgent") {
      if (
        record.isSidechain === true ||
        record.isMeta === true ||
        record.isCompactSummary === true
      ) {
        continue;
      }
      if (record.sessionId?.trim()) providerSessionId = record.sessionId.trim();
      if (record.aiTitle?.trim()) title = record.aiTitle.trim();
      const messageModel = record.message?.model?.trim();
      // Claude uses this sentinel for local error responses. It is not a
      // model ID that can be selected when the imported session resumes.
      if (messageModel && messageModel !== "<synthetic>") model = messageModel;
      if (record.type !== "user" && record.type !== "assistant") {
        continue;
      }

      const text = extractText(record.message?.content);
      if (text.length === 0) continue;
      retainMessage({
        role: record.type,
        text,
        createdAt: normalizeTimestamp(record.timestamp, fallbackTimestamp),
        codexResponseUser: false,
      });
      continue;
    }

    if (record.type === "session_meta") {
      const sessionId = record.payload?.id?.trim() || record.payload?.session_id?.trim();
      if (!hasCodexSessionId && sessionId) {
        providerSessionId = sessionId;
        hasCodexSessionId = true;
      }
      continue;
    }
    if (record.type === "turn_context" && record.payload?.model?.trim()) {
      model = record.payload.model.trim();
      continue;
    }
    if (record.type === "event_msg" && record.payload?.type === "user_message") {
      const text = record.payload.message ?? "";
      if (text.trim().length === 0) continue;
      // Codex can write the same prompt as both a response item and an event.
      // Remove only the matching response copy so mixed-format logs keep every
      // distinct user message.
      for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index];
        if (message?.role === "assistant") break;
        if (message?.codexResponseUser === true && message.text.trim() === text.trim()) {
          if (firstUserMessage === message) firstUserMessage = undefined;
          messages.splice(index, 1);
          break;
        }
      }
      retainMessage({
        role: "user",
        text,
        createdAt: normalizeTimestamp(record.timestamp, fallbackTimestamp),
        codexResponseUser: false,
      });
      continue;
    }
    if (
      record.type !== "response_item" ||
      record.payload?.type !== "message" ||
      (record.payload.role !== "user" && record.payload.role !== "assistant")
    ) {
      continue;
    }

    const extractedText = extractText(record.payload.content);
    if (extractedText.length === 0) continue;
    if (record.payload.role === "user" && canonicalCodexResponseUserIndices.has(recordIndex)) {
      continue;
    }
    if (record.payload.role === "user" && hasMatchingCodexEventInTurn(extractedText)) {
      continue;
    }
    retainMessage({
      role: record.payload.role,
      text: extractedText,
      createdAt: normalizeTimestamp(record.timestamp, fallbackTimestamp),
      codexResponseUser: record.payload.role === "user",
    });
  }

  const visibleMessages = messages.map(
    ({ codexResponseUser: _codexResponseUser, ...message }) => message,
  );
  if (providerSessionId.trim().length === 0 || firstUserMessage === undefined) return null;
  const firstUserMessageRetained = messages.includes(firstUserMessage);
  const { codexResponseUser: _codexResponseUser, ...visibleFirstUserMessage } = firstUserMessage;
  const retainedMessages = firstUserMessageRetained
    ? visibleMessages
    : [visibleFirstUserMessage, ...visibleMessages.slice(-(MAX_IMPORTED_MESSAGES - 1))];
  const derivedTitle = visibleFirstUserMessage.text.trim().split("\n")[0]?.slice(0, 100).trim();

  return {
    source: input.source,
    providerInstanceId: input.providerInstanceId,
    providerSessionId,
    title: title ?? (derivedTitle && derivedTitle.length > 0 ? derivedTitle : "Imported thread"),
    model,
    createdAt: retainedMessages[0]?.createdAt ?? fallbackTimestamp,
    updatedAt: fallbackTimestamp,
    messages: retainedMessages,
    historyTruncated: input.historyTruncated === true || !firstUserMessageRetained,
  };
}

/**
 * The line that says which conversation this is. The title can be the model's
 * own summary, so the first thing the user actually typed is shown beside it.
 */
function threadPreview(thread: AgentSessionThread): string {
  const firstUserMessage = thread.messages.find((message) => message.role === "user");
  if (firstUserMessage === undefined) return "";
  const collapsed = firstUserMessage.text.replace(/\s+/g, " ").trim();
  return collapsed.length > THREAD_PREVIEW_CHARS
    ? `${collapsed.slice(0, THREAD_PREVIEW_CHARS - 1).trimEnd()}…`
    : collapsed;
}

function extractDecodedCwd(record: DecodedTranscriptRecord): string | null {
  const cwd = record.cwd?.trim() || record.payload?.cwd?.trim();
  return cwd && cwd.length > 0 ? cwd : null;
}

/**
 * Whether a record becomes a message somebody reads. This is what bounds the
 * backwards scan: it stops after `MAX_IMPORTED_MESSAGES` of these, not after a
 * count of records, because a coding transcript is mostly tool traffic and a
 * record count would stop in the middle of a tool call's exhaust.
 */
function recordYieldsMessageText(
  source: AgentSessionSource,
  record: DecodedTranscriptRecord,
): boolean {
  if (source === "claudeAgent") {
    if (record.isSidechain === true || record.isMeta === true || record.isCompactSummary === true) {
      return false;
    }
    if (record.type !== "user" && record.type !== "assistant") return false;
    return extractText(record.message?.content).length > 0;
  }
  if (record.type === "event_msg" && record.payload?.type === "user_message") {
    return (record.payload.message ?? "").trim().length > 0;
  }
  return (
    record.type === "response_item" &&
    record.payload?.type === "message" &&
    (record.payload.role === "user" || record.payload.role === "assistant") &&
    extractText(record.payload.content).length > 0
  );
}

function concatBytes(
  left: Uint8Array<ArrayBufferLike>,
  right: Uint8Array<ArrayBufferLike>,
): Uint8Array<ArrayBufferLike> {
  if (right.byteLength === 0) return left;
  const joined = new Uint8Array(left.byteLength + right.byteLength);
  joined.set(left, 0);
  joined.set(right, left.byteLength);
  return joined;
}

/**
 * The metadata a transcript carries outside its messages, gathered while the
 * tail is read so nothing large has to be retained to find it.
 */
interface TranscriptTailMetadata {
  cwd: string | null;
  claudeSessionId: string | null;
  codexSessionId: string | null;
  aiTitle: string | null;
  model: string | null;
}

/**
 * Rebuild the metadata as records, so one parser still reads every transcript.
 * They are synthesized rather than retained because the records they came from
 * can be megabytes of compaction summary, and only these fields are wanted.
 */
function metadataRecords(
  source: AgentSessionSource,
  metadata: TranscriptTailMetadata,
): Array<DecodedTranscriptRecord> {
  if (source === "claudeAgent") {
    const record: DecodedTranscriptRecord = {
      ...(metadata.cwd === null ? {} : { cwd: metadata.cwd }),
      ...(metadata.claudeSessionId === null ? {} : { sessionId: metadata.claudeSessionId }),
      ...(metadata.aiTitle === null ? {} : { aiTitle: metadata.aiTitle }),
      ...(metadata.model === null ? {} : { message: { model: metadata.model } }),
    };
    return Object.keys(record).length === 0 ? [] : [record];
  }
  const records: Array<DecodedTranscriptRecord> = [];
  if (metadata.codexSessionId !== null || metadata.cwd !== null) {
    records.push({
      type: "session_meta",
      payload: {
        ...(metadata.codexSessionId === null ? {} : { id: metadata.codexSessionId }),
        ...(metadata.cwd === null ? {} : { cwd: metadata.cwd }),
      },
    });
  }
  if (metadata.model !== null) {
    records.push({ type: "turn_context", payload: { model: metadata.model } });
  }
  return records;
}

/**
 * Fold one record's metadata into what the scan has already found.
 *
 * Reading backwards, the cwd of every record is kept in turn, so the earliest
 * one reached wins: a session belongs to the directory it started in, and a
 * later record naming another directory must not move it into that project.
 * Title and model are the opposite — the newest is the current one — and the
 * newest is what a backwards scan sees first.
 */
function collectTranscriptMetadata(
  source: AgentSessionSource,
  record: DecodedTranscriptRecord,
  into: TranscriptTailMetadata,
  direction: "backwards" | "forwards" = "backwards",
): void {
  const cwd = extractDecodedCwd(record);
  if (direction === "backwards") {
    if (cwd !== null) into.cwd = cwd;
  } else {
    into.cwd ??= cwd;
  }
  if (source === "claudeAgent") {
    if (into.claudeSessionId === null && record.sessionId?.trim()) {
      into.claudeSessionId = record.sessionId.trim();
    }
    if (into.aiTitle === null && record.aiTitle?.trim()) into.aiTitle = record.aiTitle.trim();
    const messageModel = record.message?.model?.trim();
    if (into.model === null && messageModel && messageModel !== "<synthetic>") {
      into.model = messageModel;
    }
    return;
  }
  if (record.type === "session_meta" && into.codexSessionId === null) {
    const sessionId = record.payload?.id?.trim() || record.payload?.session_id?.trim();
    if (sessionId) into.codexSessionId = sessionId;
  }
  if (record.type === "turn_context" && into.model === null && record.payload?.model?.trim()) {
    into.model = record.payload.model.trim();
  }
}

/** True once nothing more can be learned from the head of the file. */
function transcriptMetadataComplete(
  source: AgentSessionSource,
  metadata: TranscriptTailMetadata,
): boolean {
  if (metadata.cwd === null) return false;
  return source === "claudeAgent" ? true : metadata.codexSessionId !== null;
}

/**
 * T3 Code runs its own agent sessions inside disposable worktrees. Their
 * transcripts look exactly like user sessions, but re-importing the app's own
 * sandboxes as projects is never right. Matches this server's configured
 * worktrees directory plus the conventional `.t3/worktrees` layout, which
 * also catches sandboxes from other T3 homes on the same machine. Separators
 * are normalized (and, on Windows, case folded) so the prefix match holds
 * there too. Callers check both the recorded spelling and its realpath so a
 * symlink into the worktrees directory cannot bypass the filter.
 */
function normalizeForWorktreeMatch(value: string, caseFold: boolean): string {
  const normalized = `${value.replaceAll("\\", "/")}/`;
  return caseFold ? normalized.toLowerCase() : normalized;
}

function isT3ManagedWorktree(
  candidatePath: string,
  worktreesDir: string,
  caseFold: boolean,
): boolean {
  const normalized = normalizeForWorktreeMatch(candidatePath, caseFold);
  return (
    normalized.startsWith(normalizeForWorktreeMatch(worktreesDir, caseFold)) ||
    normalized.includes("/.t3/worktrees/")
  );
}

/** Extract `cwd` from a session-meta record, tolerating the shapes each CLI writes. */
function extractCwd(line: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const record = parsed as Record<string, unknown>;
  if (typeof record.cwd === "string" && record.cwd.trim().length > 0) {
    return record.cwd;
  }
  // Codex nests session metadata under `payload`.
  const payload = record.payload;
  if (typeof payload === "object" && payload !== null) {
    const nested = (payload as Record<string, unknown>).cwd;
    if (typeof nested === "string" && nested.trim().length > 0) {
      return nested;
    }
  }
  return null;
}

function transcriptIdentity(filePath: string, stats: FileSystem.File.Info) {
  return {
    filePath,
    size: Number(stats.size),
    mtimeMs: Option.match(stats.mtime, { onNone: () => null, onSome: (date) => date.getTime() }),
    device: stats.dev,
    inode: Option.getOrNull(stats.ino),
    birthtimeMs: Option.match(stats.birthtime, {
      onNone: () => null,
      onSome: (date) => date.getTime(),
    }),
  };
}

function sameTranscriptIdentity(
  left: ReturnType<typeof transcriptIdentity>,
  right: ReturnType<typeof transcriptIdentity>,
): boolean {
  return (
    left.filePath === right.filePath &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.device === right.device &&
    left.inode === right.inode &&
    left.birthtimeMs === right.birthtimeMs
  );
}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  // Different project imports can arrive concurrently from multiple clients.
  // Only one transcript may hold its selected-history budget at a time.
  const importReadLock = yield* Semaphore.make(1);
  const path = yield* Path.Path;
  const serverConfig = yield* ServerConfig.ServerConfig;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const baseDir = path.resolve(serverConfig.baseDir);
  const worktreesDir = path.resolve(serverConfig.worktreesDir);
  // Windows filesystems are case-insensitive, so path prefix checks there
  // must case fold.
  const foldWorktreeCase = (yield* HostProcessPlatform) === "win32";
  const hostEnvironment = yield* HostProcessEnvironment;
  const homeDir = NodeOS.homedir();
  // `/private/tmp` is what macOS reports for sessions started in `/tmp`.
  const excludedProjectRoots = new Set(
    [homeDir, NodeOS.tmpdir(), "/tmp", "/private/tmp"].map((directory) =>
      normalizeProjectPathForComparison(path.resolve(directory)),
    ),
  );
  // Codex creates one scratch directory per conversation under
  // ~/Documents/Codex/<date>/<slug>. Neither those nor anything a user
  // unpacked into Downloads is a project.
  const excludedProjectAncestors = [
    path.join(homeDir, "Downloads"),
    path.join(homeDir, "Documents", "Codex"),
  ];

  const isExcludedProjectPath = (candidatePath: string) =>
    excludedProjectRoots.has(normalizeProjectPathForComparison(candidatePath)) ||
    excludedProjectAncestors.some((ancestor) =>
      normalizeForWorktreeMatch(candidatePath, foldWorktreeCase).startsWith(
        normalizeForWorktreeMatch(ancestor, foldWorktreeCase),
      ),
    ) ||
    normalizeForWorktreeMatch(candidatePath, foldWorktreeCase).startsWith(
      normalizeForWorktreeMatch(baseDir, foldWorktreeCase),
    ) ||
    isT3ManagedWorktree(candidatePath, worktreesDir, foldWorktreeCase);

  const listDirectory = (directory: string) =>
    fileSystem.readDirectory(directory).pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));

  const statOption = (target: string) =>
    fileSystem.stat(target).pipe(Effect.map(Option.some), Effect.orElseSucceed(Option.none));

  /** Match directory aliases without assuming the host volume is case-insensitive. */
  const directoryIdentity = Effect.fn("AgentSessionScanner.directoryIdentity")(function* (
    target: string,
    knownStats?: FileSystem.File.Info,
  ) {
    const resolved = path.resolve(target);
    const stats = knownStats === undefined ? yield* statOption(resolved) : Option.some(knownStats);
    if (
      Option.isSome(stats) &&
      Option.isSome(stats.value.ino) &&
      Number.isSafeInteger(stats.value.ino.value) &&
      stats.value.ino.value > 0
    ) {
      return `inode:${stats.value.dev}:${stats.value.ino.value}`;
    }
    const realPath = yield* fileSystem
      .realPath(resolved)
      .pipe(Effect.orElseSucceed(() => resolved));
    return `path:${normalizeProjectPathForComparison(realPath)}`;
  });

  /**
   * Git identity of a directory, or the reason it has none. Reads `.git`
   * directly instead of spawning git so a scan over hundreds of candidates
   * stays cheap. A `.git` file is a `gitdir:` pointer. When it points into a
   * `worktrees/` directory the checkout is a linked worktree, which
   * onboarding skips because its history belongs to the main checkout.
   * Submodules use the same pointer shape but live under `modules/`, and
   * are offered like any other repository.
   */
  const readGitIdentity = Effect.fn("AgentSessionScanner.readGitIdentity")(function* (
    directory: string,
  ): Effect.fn.Return<
    | { readonly _tag: "Repository"; readonly git: AgentSessionProjectGit | null }
    | { readonly _tag: "Worktree" }
    | { readonly _tag: "NotGit" }
  > {
    const gitPath = path.join(directory, ".git");
    const gitStats = yield* statOption(gitPath);
    if (Option.isNone(gitStats)) return { _tag: "NotGit" } as const;
    let gitDir = gitPath;
    if (gitStats.value.type !== "Directory") {
      const pointer = yield* fileSystem
        .readFileString(gitPath)
        .pipe(Effect.orElseSucceed(() => ""));
      const target = /^gitdir:\s*(.+)$/m.exec(pointer)?.[1]?.trim();
      if (target === undefined || target.length === 0) return { _tag: "NotGit" } as const;
      gitDir = path.resolve(directory, target);
      if (/[\\/]worktrees[\\/][^\\/]+[\\/]?$/.test(gitDir)) return { _tag: "Worktree" } as const;
    }
    const configText = yield* fileSystem
      .readFileString(path.join(gitDir, "config"))
      .pipe(Effect.orElseSucceed(() => ""));
    const originUrl = parseOriginUrlFromGitConfig(configText);
    return {
      _tag: "Repository",
      git: {
        remoteKey: originUrl === null ? null : normalizeGitRemoteUrl(originUrl),
        repository: parseGitHubRepositoryNameWithOwnerFromRemoteUrl(originUrl),
      },
    } as const;
  });

  /**
   * Which directory a transcript ran in.
   *
   * Read forwards first, because both CLIs normally name it in their first
   * record. A Claude session continued after compaction does not: its preamble
   * is `history-suppression`, `ai-title`, `agent-name`, `mode` and
   * `permission-mode`, and in one real transcript the first `cwd` sat at byte
   * 952,129 — inside the forward budget by 96 KB, so a slightly longer summary
   * would have dropped that session from the scan without a word. Claude writes
   * `cwd` on every record, so when the head does not answer, the end of the
   * file does, in one read.
   */
  const readCwd = Effect.fn("AgentSessionScanner.readCwd")(function* (
    transcript: TranscriptCandidate,
    budget: MetadataReadBudget,
  ) {
    if (transcript.size === 0) return null;
    if (
      budget.bytesRemaining === 0 ||
      budget.operationsRemaining < 2 ||
      budget.recordsRemaining === 0
    ) {
      budget.truncated = true;
      return null;
    }
    budget.operationsRemaining -= 1;
    return yield* Effect.scoped(
      fileSystem.open(transcript.filePath, { flag: "r" }).pipe(
        Effect.flatMap((file) =>
          Effect.gen(function* () {
            const decoder = new TextDecoder();
            let remaining = "";
            let bytesRead = 0;
            let recordsRead = 0;
            const maxBytes = Math.min(MAX_TRANSCRIPT_SCAN_BYTES, transcript.size);
            const reserveRecord = () => {
              if (
                recordsRead === MAX_METADATA_RECORDS_PER_TRANSCRIPT ||
                budget.recordsRemaining === 0
              ) {
                budget.truncated = true;
                return false;
              }
              recordsRead += 1;
              budget.recordsRemaining -= 1;
              return true;
            };
            const readLastRecord = () => {
              const record = remaining + decoder.decode();
              return record.length === 0 || !reserveRecord() ? null : extractCwd(record.trim());
            };

            while (bytesRead < maxBytes) {
              if (budget.bytesRemaining === 0 || budget.operationsRemaining === 0) {
                budget.truncated = true;
                return null;
              }
              const readSize = Math.min(
                METADATA_READ_BYTES,
                maxBytes - bytesRead,
                budget.bytesRemaining,
              );
              budget.operationsRemaining -= 1;
              budget.bytesRemaining -= readSize;
              const next = yield* file.readAlloc(readSize);
              if (Option.isNone(next)) {
                return readLastRecord();
              }

              bytesRead += next.value.byteLength;
              remaining += decoder.decode(next.value, { stream: true });
              const lines = remaining.split("\n");
              remaining = lines.pop() ?? "";

              for (const line of lines) {
                if (!reserveRecord()) return null;
                const cwd = extractCwd(line.trim());
                if (cwd !== null) return cwd;
              }
            }

            if (bytesRead < transcript.size) {
              return yield* readCwdBackwards(file, transcript, budget);
            }
            return readLastRecord();
          }),
        ),
      ),
    ).pipe(Effect.orElseSucceed(() => null));
  });

  /** The cwd from the end of a transcript, for heads that never named one. */
  const readCwdBackwards = Effect.fn("AgentSessionScanner.readCwdBackwards")(function* (
    file: FileSystem.File,
    transcript: TranscriptCandidate,
    budget: MetadataReadBudget,
  ) {
    const maxBytes = Math.min(MAX_CWD_TAIL_SCAN_BYTES, transcript.size, budget.bytesRemaining);
    if (maxBytes === 0 || budget.operationsRemaining === 0 || budget.recordsRemaining === 0) {
      budget.truncated = true;
      return null;
    }
    let found: string | null = null;
    let recordsRead = 0;
    const scan = yield* readLinesBackwards({
      file,
      size: transcript.size,
      maxBytes,
      onLine: (line) => {
        if (recordsRead === MAX_METADATA_RECORDS_PER_TRANSCRIPT || budget.recordsRemaining === 0) {
          budget.truncated = true;
          return "stop";
        }
        recordsRead += 1;
        budget.recordsRemaining -= 1;
        found = extractCwd(line);
        return found === null ? "continue" : "stop";
      },
    });
    budget.operationsRemaining -= 1;
    budget.bytesRemaining -= Math.min(budget.bytesRemaining, scan?.bytesRead ?? maxBytes);
    if (found === null) budget.truncated = true;
    return found;
  });

  /** Read exactly `length` bytes at `from`; null when the file no longer holds them. */
  const readRegion = Effect.fn("AgentSessionScanner.readRegion")(function* (
    file: FileSystem.File,
    from: number,
    length: number,
  ) {
    yield* file.seek(BigInt(from), "start");
    const buffer = new Uint8Array(length);
    let filled = 0;
    while (filled < length) {
      const next = yield* file.readAlloc(length - filled);
      if (Option.isNone(next) || next.value.byteLength === 0) return null;
      buffer.set(next.value, filled);
      filled += next.value.byteLength;
    }
    return buffer;
  });

  /**
   * Walk a transcript's complete records backwards from its end, newest first,
   * until `onLine` says stop or the read budget ends. Chunks are joined at
   * record boundaries, so no line is ever decoded from a partial read.
   */
  const readLinesBackwards = Effect.fn("AgentSessionScanner.readLinesBackwards")(function* (input: {
    readonly file: FileSystem.File;
    readonly size: number;
    readonly maxBytes: number;
    readonly onLine: (line: string) => "stop" | "continue";
  }) {
    const decoder = new TextDecoder();
    const emit = (bytes: Uint8Array) => {
      const line = decoder.decode(bytes).trim();
      return line.length === 0 ? true : input.onLine(line) === "continue";
    };

    let position = input.size;
    let bytesRead = 0;
    // Bytes whose record began before `position`, held until that record's
    // start is read.
    let remainder: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
    let stopped = false;
    // One record can be a screenshot or a whole file's worth of tool output.
    // Past the per-record ceiling its bytes are dropped rather than held, so
    // the messages on the other side of it are still reachable.
    let skippingOversizedRecord = false;

    while (position > 0 && !stopped && bytesRead < input.maxBytes) {
      const chunkSize = Math.min(TAIL_CHUNK_BYTES, position, input.maxBytes - bytesRead);
      const from = position - chunkSize;
      const chunk = yield* readRegion(input.file, from, chunkSize);
      if (chunk === null) return null;
      bytesRead += chunkSize;
      position = from;
      const buffer = skippingOversizedRecord ? chunk : concatBytes(chunk, remainder);
      let end = buffer.byteLength;
      if (skippingOversizedRecord) {
        const lastNewline = buffer.lastIndexOf(10);
        if (lastNewline === -1) continue;
        end = lastNewline;
        skippingOversizedRecord = false;
      }
      const firstNewline = buffer.indexOf(10);
      if (firstNewline === -1 || firstNewline >= end) {
        remainder = buffer.subarray(0, end);
        if (remainder.byteLength > MAX_RECORD_BUFFER_BYTES) {
          remainder = new Uint8Array(0);
          skippingOversizedRecord = true;
        }
        continue;
      }
      remainder = buffer.subarray(0, firstNewline + 1);
      for (let index = end - 1; index >= firstNewline; index--) {
        if (buffer[index] !== 10) continue;
        if (index + 1 < end && !emit(buffer.subarray(index + 1, end))) {
          stopped = true;
          break;
        }
        end = index;
      }
    }
    // At offset 0 the held bytes are the file's first record, not a fragment.
    if (!stopped && position === 0 && remainder.byteLength > 0 && !emit(remainder)) {
      stopped = true;
    }
    return { bytesRead, reachedStart: position === 0 && !stopped };
  });

  /** The same walk forwards, for what only the start of a transcript knows. */
  const readLinesForward = Effect.fn("AgentSessionScanner.readLinesForward")(function* (input: {
    readonly file: FileSystem.File;
    readonly size: number;
    readonly maxBytes: number;
    readonly onLine: (line: string) => "stop" | "continue";
  }) {
    const decoder = new TextDecoder();
    let position = 0;
    let bytesRead = 0;
    let remainder: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
    let stopped = false;

    while (position < input.size && !stopped && bytesRead < input.maxBytes) {
      const chunkSize = Math.min(
        TAIL_CHUNK_BYTES,
        input.size - position,
        input.maxBytes - bytesRead,
      );
      const chunk = yield* readRegion(input.file, position, chunkSize);
      if (chunk === null) return null;
      bytesRead += chunkSize;
      position += chunkSize;
      const buffer = concatBytes(remainder, chunk);
      let start = 0;
      let newline = buffer.indexOf(10, start);
      while (newline !== -1) {
        const line = decoder.decode(buffer.subarray(start, newline)).trim();
        if (line.length > 0 && input.onLine(line) === "stop") {
          stopped = true;
          break;
        }
        start = newline + 1;
        newline = buffer.indexOf(10, start);
      }
      remainder = buffer.subarray(start);
    }
    if (!stopped && position >= input.size && remainder.byteLength > 0) {
      const line = decoder.decode(remainder).trim();
      if (line.length > 0) input.onLine(line);
    }
    return { bytesRead };
  });

  /**
   * A transcript's last messages, read from the end of the file.
   *
   * The identity is checked on both sides of the read: a transcript that is
   * being appended to while it is imported is rejected rather than half-read.
   * Only the messages themselves are retained — the metadata records they sit
   * among are folded into fields, because a single compaction summary can be
   * most of a megabyte and none of it is wanted.
   */
  const readTranscript = Effect.fn("AgentSessionScanner.readTranscript")(function* (
    filePath: string,
    expected: ReturnType<typeof transcriptIdentity>,
    recordLimit: number,
    source: AgentSessionSource,
  ) {
    if (expected.size > MAX_IMPORTED_TRANSCRIPT_BYTES) return null;
    if (expected.size === 0) return null;

    return yield* Effect.scoped(
      fileSystem.open(filePath, { flag: "r" }).pipe(
        Effect.flatMap((file) =>
          Effect.gen(function* () {
            if (!sameTranscriptIdentity(expected, transcriptIdentity(filePath, yield* file.stat))) {
              return null;
            }

            const metadata: TranscriptTailMetadata = {
              cwd: null,
              claudeSessionId: null,
              codexSessionId: null,
              aiTitle: null,
              model: null,
            };
            const newestFirst: Array<DecodedTranscriptRecord> = [];
            const recordCeiling = Math.min(recordLimit, MAX_TAIL_RECORDS);
            let scanned = 0;
            let messageRecords = 0;

            const tail = yield* readLinesBackwards({
              file,
              size: expected.size,
              maxBytes: MAX_TAIL_SCAN_BYTES,
              onLine: (line) => {
                scanned += 1;
                if (scanned > recordCeiling) return "stop";
                const decoded = decodeTranscriptRecord(line);
                if (Option.isNone(decoded)) return "continue";
                collectTranscriptMetadata(source, decoded.value, metadata);
                if (!recordYieldsMessageText(source, decoded.value)) return "continue";
                newestFirst.push(decoded.value);
                messageRecords += 1;
                return messageRecords >= MAX_IMPORTED_MESSAGES ? "stop" : "continue";
              },
            });
            if (tail === null) return null;

            // Where the tail did not reach the start, the start still owns two
            // answers: the directory the session began in — which is the project
            // it belongs to, whatever a later record says — and, for Codex, the
            // id it resumes by, written once in the first record.
            // A transcript can end in one enormous record — a screenshot, or a
            // file read — whose bytes alone exhaust the backwards budget. Then
            // the readable conversation is at the other end, so take it there.
            const oldestFirst: Array<DecodedTranscriptRecord> = [];
            const wantHeadMessages = newestFirst.length === 0;
            if (!tail.reachedStart) {
              const head: TranscriptTailMetadata = {
                cwd: null,
                claudeSessionId: null,
                codexSessionId: null,
                aiTitle: null,
                model: null,
              };
              yield* readLinesForward({
                file,
                size: expected.size,
                maxBytes: MAX_HEAD_SCAN_BYTES,
                onLine: (line) => {
                  scanned += 1;
                  const decoded = decodeTranscriptRecord(line);
                  if (Option.isNone(decoded)) return "continue";
                  collectTranscriptMetadata(source, decoded.value, head, "forwards");
                  if (wantHeadMessages && recordYieldsMessageText(source, decoded.value)) {
                    oldestFirst.push(decoded.value);
                  }
                  if (!transcriptMetadataComplete(source, head)) return "continue";
                  return wantHeadMessages && oldestFirst.length < MAX_IMPORTED_MESSAGES
                    ? "continue"
                    : "stop";
                },
              });
              metadata.cwd = head.cwd ?? metadata.cwd;
              metadata.codexSessionId ??= head.codexSessionId;
              metadata.claudeSessionId ??= head.claudeSessionId;
              metadata.aiTitle ??= head.aiTitle;
              metadata.model ??= head.model;
            }

            if (!sameTranscriptIdentity(expected, transcriptIdentity(filePath, yield* file.stat))) {
              return null;
            }
            return {
              records: [
                ...metadataRecords(source, metadata),
                ...oldestFirst,
                ...newestFirst.toReversed(),
              ],
              recordCount: scanned,
              cwd: metadata.cwd,
              historyTruncated: !tail.reachedStart,
            };
          }),
        ),
      ),
    ).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Could not read imported transcript", { filePath, cause }).pipe(
          Effect.as(null),
        ),
      ),
    );
  });

  /**
   * Resolve the Claude config directory the CLI would use, matching the
   * precedence the spawned CLI sees: the instance's `homePath` (exported as
   * `CLAUDE_CONFIG_DIR`), then a `CLAUDE_CONFIG_DIR` already in the
   * environment, then `~/.claude`.
   */
  const resolveClaudeConfigDir = (homePath: string, environmentHome?: string): string => {
    const configured = homePath.trim();
    if (configured.length > 0) {
      return path.resolve(expandHomePath(configured));
    }
    const fromEnvironment = environmentHome?.trim() ?? "";
    if (fromEnvironment.length > 0) {
      return path.resolve(expandHomePath(fromEnvironment));
    }
    return path.join(NodeOS.homedir(), ".claude");
  };

  const discoverClaudeTranscripts = Effect.fn("AgentSessionScanner.discoverClaudeTranscripts")(
    function* (homePath: string, providerInstanceId: ProviderInstanceId, operationBudget: number) {
      const projectsDir = path.join(homePath, "projects");
      let operationsRemaining = operationBudget;
      let truncated = false;
      const readDirectory = (directory: string) => {
        if (operationsRemaining <= 0) {
          truncated = true;
          return Effect.succeed<ReadonlyArray<string>>([]);
        }
        operationsRemaining -= 1;
        return listDirectory(directory);
      };
      const projectDirectories = yield* readDirectory(projectsDir);
      const transcripts: Array<TranscriptCandidate> = [];

      for (const projectDirectory of projectDirectories) {
        if (operationsRemaining <= 0) {
          truncated = true;
          break;
        }
        const directory = path.join(projectsDir, projectDirectory);
        const directoryTranscripts = (yield* readDirectory(directory))
          .filter((entry) => entry.endsWith(".jsonl"))
          .map((entry) => path.join(directory, entry));

        for (const filePath of directoryTranscripts) {
          if (operationsRemaining <= 0) {
            truncated = true;
            break;
          }
          operationsRemaining -= 1;
          const stats = yield* statOption(filePath);
          if (
            Option.isNone(stats) ||
            stats.value.type !== "File" ||
            Option.isNone(stats.value.mtime)
          ) {
            continue;
          }
          transcripts.push({
            filePath,
            mtimeMs: stats.value.mtime.value.getTime(),
            providerInstanceId,
            size: Number(stats.value.size),
          });
        }
      }
      return { transcripts, truncated };
    },
  );

  const discoverCodexTranscripts = Effect.fn("AgentSessionScanner.discoverCodexTranscripts")(
    function* (homePath: string, providerInstanceId: ProviderInstanceId, operationBudget: number) {
      const sessionsDir = path.join(homePath, "sessions");

      const transcripts: Array<TranscriptCandidate> = [];
      let operationsRemaining = operationBudget;
      let truncated = false;
      const readDirectory = (directory: string) => {
        if (operationsRemaining <= 0) {
          truncated = true;
          return Effect.succeed<ReadonlyArray<string>>([]);
        }
        operationsRemaining -= 1;
        return listDirectory(directory);
      };
      // Date-partitioned directories sort chronologically, so walking them in
      // reverse spends each home's share of the operation budget on recent sessions.
      for (const year of (yield* readDirectory(sessionsDir)).toSorted().toReversed()) {
        if (operationsRemaining <= 0) {
          truncated = true;
          break;
        }
        for (const month of (yield* readDirectory(path.join(sessionsDir, year)))
          .toSorted()
          .toReversed()) {
          if (operationsRemaining <= 0) {
            truncated = true;
            break;
          }
          for (const day of (yield* readDirectory(path.join(sessionsDir, year, month)))
            .toSorted()
            .toReversed()) {
            if (operationsRemaining <= 0) {
              truncated = true;
              break;
            }
            const directory = path.join(sessionsDir, year, month, day);
            for (const entry of (yield* readDirectory(directory)).toSorted().toReversed()) {
              if (!entry.startsWith("rollout-") || !entry.endsWith(".jsonl")) continue;
              if (operationsRemaining <= 0) {
                truncated = true;
                break;
              }
              const filePath = path.join(directory, entry);
              operationsRemaining -= 1;
              const stats = yield* statOption(filePath);
              if (
                Option.isSome(stats) &&
                stats.value.type === "File" &&
                Option.isSome(stats.value.mtime)
              ) {
                transcripts.push({
                  filePath,
                  mtimeMs: stats.value.mtime.value.getTime(),
                  providerInstanceId,
                  size: Number(stats.value.size),
                });
              }
            }
          }
        }
      }
      return { transcripts, truncated };
    },
  );

  const groupTranscriptsByCwd = Effect.fn("AgentSessionScanner.groupTranscriptsByCwd")(function* (
    source: AgentSessionSource,
    transcripts: ReadonlyArray<TranscriptCandidate>,
    budget: MetadataReadBudget,
  ) {
    const byOwnerAndCwd = new Map<
      string,
      {
        cwd: string;
        providerInstanceId: ProviderInstanceId;
        lastActiveAtMs: number;
        transcripts: Array<{ filePath: string; mtimeMs: number }>;
      }
    >();

    for (const transcript of transcripts) {
      const cwd = yield* readCwd(transcript, budget);
      if (cwd === null) continue;
      const key = `${transcript.providerInstanceId}\0${cwd}`;
      const existing = byOwnerAndCwd.get(key);
      if (existing) {
        existing.lastActiveAtMs = Math.max(existing.lastActiveAtMs, transcript.mtimeMs);
        existing.transcripts.push(transcript);
      } else {
        byOwnerAndCwd.set(key, {
          cwd,
          providerInstanceId: transcript.providerInstanceId,
          lastActiveAtMs: transcript.mtimeMs,
          transcripts: [transcript],
        });
      }
    }

    return Array.from(byOwnerAndCwd.values(), (group): RawCandidate => ({
      cwd: group.cwd,
      source,
      providerInstanceId: group.providerInstanceId,
      threadCount: group.transcripts.length,
      lastActiveAtMs: group.lastActiveAtMs,
      transcripts: group.transcripts,
    }));
  });

  const collectCandidates = Effect.fn("AgentSessionScanner.collectCandidates")(function* () {
    const settings = yield* serverSettings.getSettings.pipe(
      Effect.mapError((cause) => new AgentSessionScanError({ operation: "read-settings", cause })),
    );

    const raw: Array<RawCandidate> = [];
    let truncated = false;

    for (const source of ["claudeAgent", "codex"] as const) {
      const instances: Array<{
        readonly instanceId: ProviderInstanceId;
        readonly config: ProviderInstanceConfig;
      }> = Object.entries(settings.providerInstances)
        .filter(
          ([, instance]) => instance.driver === source && resolveProviderInstanceEnabled(instance),
        )
        .map(([instanceId, config]) => ({
          instanceId: ProviderInstanceId.make(instanceId),
          config,
        }));
      if (!Object.hasOwn(settings.providerInstances, source)) {
        const legacyInstance = {
          instanceId: ProviderInstanceId.make(source),
          config: {
            driver: ProviderDriverKind.make(source),
            config: settings.providers[source],
          },
        };
        if (resolveProviderInstanceEnabled(legacyInstance.config)) {
          instances.push(legacyInstance);
        }
      }

      // A shared home contains one copy of each session. Prefer the built-in
      // instance as its owner, then keep configured order for custom accounts.
      instances.sort((left, right) => {
        const leftDefault = left.instanceId === source ? 0 : 1;
        const rightDefault = right.instanceId === source ? 0 : 1;
        return leftDefault - rightDefault;
      });
      const homes: Array<{ homePath: string; providerInstanceId: ProviderInstanceId }> = [];
      const seenHomes = new Set<string>();
      for (const { instanceId, config: instance } of instances) {
        const homeVariable = source === "claudeAgent" ? "CLAUDE_CONFIG_DIR" : "CODEX_HOME";
        const environmentHome =
          instance.environment?.findLast((variable) => variable.name === homeVariable)?.value ??
          hostEnvironment[homeVariable];

        let homePath: string;
        if (source === "claudeAgent") {
          const config = decodeClaudeSettings(instance.config ?? {});
          if (Option.isNone(config)) continue;
          homePath = resolveClaudeConfigDir(config.value.homePath, environmentHome);
        } else {
          const config = decodeCodexSettings(instance.config ?? {});
          if (Option.isNone(config)) continue;
          const codexSettings =
            config.value.homePath.trim().length === 0 &&
            config.value.shadowHomePath.trim().length === 0 &&
            environmentHome?.trim()
              ? { ...config.value, homePath: environmentHome }
              : config.value;
          const layout = yield* resolveCodexHomeLayout(codexSettings).pipe(
            Effect.provideService(Path.Path, path),
          );
          homePath = layout.sharedHomePath;
        }

        // Two accounts can keep separate credentials and share one transcript
        // tree — which is exactly what an added Claude account does here, since
        // `projects` is a link to the primary's (D52). Deduplicating on the home
        // would then list every conversation once per account, as if the same
        // session had happened three times. The directory that actually holds
        // the transcripts is the thing to compare, and a link resolves to the
        // same identity as its target.
        const transcriptsDir = path.join(
          homePath,
          source === "claudeAgent" ? "projects" : "sessions",
        );
        const homeKey = `${source}\0${yield* directoryIdentity(transcriptsDir)}`;
        if (seenHomes.has(homeKey)) continue;
        seenHomes.add(homeKey);
        homes.push({ homePath, providerInstanceId: instanceId });
      }

      const transcriptCandidates: Array<TranscriptCandidate> = [];
      const baseOperationBudget = Math.floor(
        MAX_DISCOVERY_OPERATIONS_PER_SOURCE / Math.max(1, homes.length),
      );
      const extraOperationBudgets = MAX_DISCOVERY_OPERATIONS_PER_SOURCE % Math.max(1, homes.length);
      for (const [index, home] of homes.entries()) {
        const operationBudget = baseOperationBudget + (index < extraOperationBudgets ? 1 : 0);
        if (operationBudget === 0) {
          truncated = true;
          continue;
        }
        const discovered = yield* source === "claudeAgent"
          ? discoverClaudeTranscripts(home.homePath, home.providerInstanceId, operationBudget)
          : discoverCodexTranscripts(home.homePath, home.providerInstanceId, operationBudget);
        truncated ||= discovered.truncated;
        transcriptCandidates.push(...discovered.transcripts);
      }

      transcriptCandidates.sort(
        (left, right) =>
          right.mtimeMs - left.mtimeMs || left.filePath.localeCompare(right.filePath),
      );
      if (transcriptCandidates.length > MAX_TRANSCRIPTS_PER_SOURCE) {
        truncated = true;
      }
      // Give each account a turn before taking another file from the same home.
      const selectedTranscripts = selectMetadataTranscripts(transcriptCandidates);
      const metadataBudget: MetadataReadBudget = {
        bytesRemaining: MAX_METADATA_BYTES_PER_SOURCE,
        operationsRemaining: MAX_METADATA_OPERATIONS_PER_SOURCE,
        recordsRemaining: MAX_METADATA_RECORDS_PER_SOURCE,
        truncated: false,
      };
      raw.push(...(yield* groupTranscriptsByCwd(source, selectedTranscripts, metadataBudget)));
      truncated ||= metadataBudget.truncated;
    }

    return { candidates: raw, truncated };
  });

  let cachedCandidates: ReadonlyArray<RawCandidate> | null = null;
  /** Whether the cached discovery pass hit a budget, reported with the listing. */
  let cachedCandidatesTruncated = false;

  const scan: AgentSessionScanner["Service"]["scan"] = Effect.gen(function* () {
    const { candidates: raw, truncated } = yield* collectCandidates();
    cachedCandidates = raw;
    cachedCandidatesTruncated = truncated;

    // Filesystem identity merges symlinks and case aliases without collapsing
    // distinct case-sensitive directories.
    const merged = new Map<
      string,
      {
        path: string;
        sources: Array<AgentSessionSource>;
        threadCount: number;
        lastActiveAtMs: number | null;
        git: AgentSessionProjectGit | null;
      }
    >();
    const directoryKeys = new Map<string, string>();
    const gitIdentities = new Map<string, AgentSessionProjectGit | null>();

    for (const candidate of raw) {
      const expanded = expandHomePath(candidate.cwd.trim());
      if (!path.isAbsolute(expanded)) continue;
      const resolved = path.resolve(expanded);
      if (isExcludedProjectPath(resolved)) continue;
      let key = directoryKeys.get(resolved);
      if (key === undefined) {
        const stats = yield* statOption(resolved);
        // Directories that no longer exist can't be imported.
        if (Option.isNone(stats) || stats.value.type !== "Directory") {
          directoryKeys.set(resolved, "");
          continue;
        }
        const realPath = yield* fileSystem
          .realPath(resolved)
          .pipe(Effect.orElseSucceed(() => resolved));
        // A symlink can point into the worktrees directory even when its own
        // spelling doesn't; check again with links resolved.
        if (isExcludedProjectPath(realPath)) {
          key = "";
        } else {
          const gitIdentity = yield* readGitIdentity(resolved);
          if (gitIdentity._tag === "Worktree") {
            key = "";
          } else {
            key = yield* directoryIdentity(resolved, stats.value);
            gitIdentities.set(key, gitIdentity._tag === "Repository" ? gitIdentity.git : null);
          }
        }
        directoryKeys.set(resolved, key);
      }
      if (key === "") continue;

      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, {
          path: resolved,
          sources: [candidate.source],
          threadCount: candidate.threadCount,
          lastActiveAtMs: candidate.lastActiveAtMs,
          git: gitIdentities.get(key) ?? null,
        });
        continue;
      }
      if (!existing.sources.includes(candidate.source)) {
        existing.sources.push(candidate.source);
      }
      existing.threadCount += candidate.threadCount;
      existing.lastActiveAtMs =
        existing.lastActiveAtMs === null || candidate.lastActiveAtMs === null
          ? (existing.lastActiveAtMs ?? candidate.lastActiveAtMs)
          : Math.max(existing.lastActiveAtMs, candidate.lastActiveAtMs);
    }

    // Resolve persisted roots too. A project and a transcript can name
    // different symlinks to the same directory.
    const shellSnapshot = yield* projectionSnapshotQuery
      .getShellSnapshot()
      .pipe(
        Effect.mapError(
          (cause) => new AgentSessionScanError({ operation: "read-projects", cause }),
        ),
      );
    const importedProjectsByRoot = new Map<string, (typeof shellSnapshot.projects)[number]>();
    for (const project of shellSnapshot.projects) {
      const projectRoot = path.resolve(expandHomePath(project.workspaceRoot));
      importedProjectsByRoot.set(normalizeProjectPathForComparison(projectRoot), project);
      importedProjectsByRoot.set(yield* directoryIdentity(projectRoot), project);
    }

    const candidates: Array<AgentSessionProjectCandidate> = [];
    for (const [key, entry] of merged.entries()) {
      // Keep the path key for missing roots and use filesystem identity for
      // aliases that resolve to the same directory.
      const importedProject =
        importedProjectsByRoot.get(normalizeProjectPathForComparison(entry.path)) ??
        importedProjectsByRoot.get(key);
      const candidatePath = importedProject?.workspaceRoot ?? entry.path;
      candidates.push({
        path: candidatePath,
        title: path.basename(candidatePath) || candidatePath,
        ...(importedProject === undefined ? {} : { projectId: importedProject.id }),
        sources: entry.sources,
        threadCount: entry.threadCount,
        lastActiveAt:
          entry.lastActiveAtMs === null
            ? null
            : DateTime.formatIso(DateTime.makeUnsafe(entry.lastActiveAtMs)),
        alreadyImported: importedProject !== undefined,
        git: entry.git,
      });
    }

    // Newest first, undated candidates last.
    candidates.sort((left, right) => {
      if (left.lastActiveAt === right.lastActiveAt) return left.path.localeCompare(right.path);
      if (left.lastActiveAt === null) return 1;
      if (right.lastActiveAt === null) return -1;
      return right.lastActiveAt.localeCompare(left.lastActiveAt);
    });

    return {
      candidates,
      scannedAt: DateTime.formatIso(yield* DateTime.now),
      ...(truncated ? { truncated: true } : {}),
    };
  });

  const prepareRecentThreads = Effect.fn("AgentSessionScanner.prepareRecentThreads")(function* (
    // `null` lists every project's recent conversations rather than one
    // directory's. The import path always names a root; the listing does not.
    workspaceRoot: string | null,
    completedSources: ReadonlyArray<AgentSessionImportSource>,
  ) {
    let rootIdentity: string | null = null;
    if (workspaceRoot !== null) {
      const root = path.resolve(expandHomePath(workspaceRoot));
      const realRoot = yield* fileSystem.realPath(root).pipe(Effect.orElseSucceed(() => root));
      if (isExcludedProjectPath(root) || isExcludedProjectPath(realRoot)) {
        return { stream: Stream.empty, candidatesTruncated: false };
      }
      rootIdentity = yield* directoryIdentity(root);
    }
    const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
    const cutoffMs = nowMs - RECENT_THREAD_WINDOW_MS;

    if (cachedCandidates === null) {
      const collected = yield* collectCandidates();
      cachedCandidates = collected.candidates;
      cachedCandidatesTruncated = collected.truncated;
    }
    const candidates = cachedCandidates;
    const candidatesTruncated = cachedCandidatesTruncated;

    const eligibleTranscripts: Array<{
      readonly candidate: RawCandidate;
      readonly transcript: RawCandidate["transcripts"][number] & { readonly mtimeMs: number };
    }> = [];
    for (const candidate of candidates) {
      const expanded = expandHomePath(candidate.cwd.trim());
      if (!path.isAbsolute(expanded)) continue;
      const resolved = path.resolve(expanded);
      if (rootIdentity === null) {
        if (isExcludedProjectPath(resolved)) continue;
      } else if ((yield* directoryIdentity(resolved)) !== rootIdentity) continue;

      for (const transcript of candidate.transcripts) {
        if (
          transcript.mtimeMs === null ||
          transcript.mtimeMs < cutoffMs ||
          transcript.mtimeMs > nowMs
        ) {
          continue;
        }
        eligibleTranscripts.push({
          candidate,
          transcript: { ...transcript, mtimeMs: transcript.mtimeMs },
        });
      }
    }

    eligibleTranscripts.sort((left, right) => {
      if (left.transcript.mtimeMs !== right.transcript.mtimeMs) {
        return right.transcript.mtimeMs - left.transcript.mtimeMs;
      }
      return left.transcript.filePath.localeCompare(right.transcript.filePath);
    });

    const completedByFile = Map.groupBy(
      completedSources,
      (source) => `${source.providerInstanceId}\0${source.filePath}`,
    );
    const importedSessions = new Set<string>();
    let bytesRemaining = MAX_IMPORT_BYTES;
    let transcriptsRemaining = MAX_IMPORT_TRANSCRIPTS;
    let recordsRemaining = MAX_IMPORT_RECORDS;
    const stream = Stream.fromIteratorSucceed(eligibleTranscripts.values(), 1).pipe(
      Stream.mapEffect(({ candidate, transcript }) =>
        Effect.gen(function* () {
          const completed = completedByFile.get(
            `${candidate.providerInstanceId}\0${transcript.filePath}`,
          );
          if (
            completed === undefined &&
            (transcriptsRemaining === 0 || bytesRemaining === 0 || recordsRemaining === 0)
          ) {
            return Option.some<AgentSessionRecentThread>({ _tag: "Skipped" });
          }
          const stats = yield* statOption(transcript.filePath);
          if (Option.isNone(stats) || stats.value.type !== "File") {
            return Option.some<AgentSessionRecentThread>({ _tag: "Skipped" });
          }
          const identity = transcriptIdentity(transcript.filePath, stats.value);
          const completedSource = completed?.find(
            (source) =>
              source.provider === candidate.source && sameTranscriptIdentity(source, identity),
          );
          if (completedSource !== undefined) {
            const sessionKey = `${completedSource.providerInstanceId}\0${completedSource.providerSessionId}`;
            if (importedSessions.has(sessionKey)) return Option.none<AgentSessionRecentThread>();
            importedSessions.add(sessionKey);
            return Option.some<AgentSessionRecentThread>({
              _tag: "AlreadyImported",
              source: completedSource,
            });
          }
          // The shared budget covers what the read will touch — its tail, and
          // the head it may go back for — not the size of the history on disk.
          // A 420 MB transcript is imported from a fraction of a megabyte.
          const reservedBytes = Math.min(identity.size, MAX_TAIL_SCAN_BYTES + MAX_HEAD_SCAN_BYTES);
          if (
            transcriptsRemaining === 0 ||
            recordsRemaining === 0 ||
            identity.size > MAX_IMPORTED_TRANSCRIPT_BYTES ||
            reservedBytes > bytesRemaining
          ) {
            return Option.some<AgentSessionRecentThread>({ _tag: "Skipped" });
          }
          // Reserve it even if the read or the parse then fails.
          transcriptsRemaining -= 1;
          bytesRemaining -= reservedBytes;
          const snapshot = yield* readTranscript(
            transcript.filePath,
            identity,
            recordsRemaining,
            candidate.source,
          );
          if (snapshot === null) {
            return Option.some<AgentSessionRecentThread>({ _tag: "Skipped" });
          }
          recordsRemaining -= snapshot.recordCount;

          // A stable replacement file can belong to a different project than the cached candidate.
          const snapshotCwd = snapshot.cwd;
          if (snapshotCwd === null) {
            return Option.some<AgentSessionRecentThread>({ _tag: "Skipped" });
          }
          const expandedCwd = expandHomePath(snapshotCwd.trim());
          if (!path.isAbsolute(expandedCwd)) {
            return Option.some<AgentSessionRecentThread>({ _tag: "Skipped" });
          }
          const resolvedCwd = path.resolve(expandedCwd);
          if (rootIdentity === null) {
            // A directory nothing can be a project in is not a listing failure,
            // so it leaves no "could not import" trace behind it.
            if (isExcludedProjectPath(resolvedCwd)) return Option.none<AgentSessionRecentThread>();
          } else if ((yield* directoryIdentity(resolvedCwd)) !== rootIdentity) {
            return Option.some<AgentSessionRecentThread>({ _tag: "Skipped" });
          }

          const parsedThread = parseAgentSessionRecords(
            {
              source: candidate.source,
              providerInstanceId: candidate.providerInstanceId,
              fallbackSessionId: path.basename(transcript.filePath, ".jsonl"),
              lastActiveAtMs: transcript.mtimeMs,
              historyTruncated: snapshot.historyTruncated,
            },
            snapshot.records,
          );
          if (parsedThread === null) {
            return Option.some<AgentSessionRecentThread>({ _tag: "Skipped" });
          }

          const source: AgentSessionImportSource = {
            ...identity,
            provider: parsedThread.source,
            providerInstanceId: parsedThread.providerInstanceId,
            providerSessionId: parsedThread.providerSessionId,
          };
          const sessionKey = `${parsedThread.providerInstanceId}\0${parsedThread.providerSessionId}`;
          if (importedSessions.has(sessionKey)) {
            return Option.some<AgentSessionRecentThread>({ _tag: "Duplicate", source });
          }
          importedSessions.add(sessionKey);
          return Option.some<AgentSessionRecentThread>({
            _tag: "Importable",
            thread: parsedThread,
            source,
            workspaceRoot: resolvedCwd,
          });
        }).pipe(importReadLock.withPermits(1)),
      ),
      Stream.map(Option.toArray),
      Stream.flattenIterable,
    );
    return { stream, candidatesTruncated };
  });

  const recentThreads: AgentSessionScanner["Service"]["recentThreads"] = (
    workspaceRoot,
    completedSources = [],
  ) =>
    Stream.unwrap(
      prepareRecentThreads(workspaceRoot, completedSources).pipe(
        Effect.map((prepared) => prepared.stream),
      ),
    );

  const recentThreadSummaries: AgentSessionScanner["Service"]["recentThreadSummaries"] = Effect.fn(
    "AgentSessionScanner.recentThreadSummaries",
  )(function* (options) {
    const prepared = yield* prepareRecentThreads(options?.workspaceRoot ?? null, []);
    // One past the limit: the extra entry is what proves the list was cut,
    // and the stream is lazy, so nothing beyond it is ever read.
    const collected = yield* prepared.stream.pipe(
      Stream.map((outcome) => (outcome._tag === "Importable" ? [outcome] : [])),
      Stream.flattenIterable,
      Stream.take(MAX_LISTED_THREADS + 1),
      Stream.runCollect,
    );
    const importable = Array.from(collected);
    const overLimit = importable.length > MAX_LISTED_THREADS;
    const listed = overLimit ? importable.slice(0, MAX_LISTED_THREADS) : importable;

    const shellSnapshot = yield* projectionSnapshotQuery
      .getShellSnapshot()
      .pipe(
        Effect.mapError(
          (cause) => new AgentSessionScanError({ operation: "read-projects", cause }),
        ),
      );
    const projectsByRoot = new Map<string, (typeof shellSnapshot.projects)[number]>();
    for (const project of shellSnapshot.projects) {
      const projectRoot = path.resolve(expandHomePath(project.workspaceRoot));
      projectsByRoot.set(normalizeProjectPathForComparison(projectRoot), project);
      projectsByRoot.set(yield* directoryIdentity(projectRoot), project);
    }
    const existingThreadIds = new Set(shellSnapshot.threads.map((thread) => thread.id));
    const stillWritingAfterMs =
      DateTime.toEpochMillis(yield* DateTime.now) - STILL_WRITING_WINDOW_MS;

    const threads: Array<AgentSessionThreadSummary> = [];
    for (const outcome of listed) {
      const project =
        projectsByRoot.get(normalizeProjectPathForComparison(outcome.workspaceRoot)) ??
        projectsByRoot.get(yield* directoryIdentity(outcome.workspaceRoot));
      const threadId = importedAgentSessionThreadId(outcome.source);
      threads.push({
        provider: outcome.thread.source,
        providerInstanceId: outcome.thread.providerInstanceId,
        providerSessionId: outcome.thread.providerSessionId,
        threadId,
        title: outcome.thread.title,
        preview: threadPreview(outcome.thread),
        workspaceRoot: project?.workspaceRoot ?? outcome.workspaceRoot,
        ...(project === undefined ? {} : { projectId: project.id }),
        model: outcome.thread.model,
        messageCount: outcome.thread.messages.length,
        sizeBytes: outcome.source.size,
        startedAt: outcome.thread.createdAt,
        lastActiveAt: outcome.thread.updatedAt,
        alreadyImported: existingThreadIds.has(threadId),
        stillWriting: (outcome.source.mtimeMs ?? 0) > stillWritingAfterMs,
      });
    }

    return {
      threads,
      scannedAt: DateTime.formatIso(yield* DateTime.now),
      ...(overLimit || prepared.candidatesTruncated ? { truncated: true } : {}),
    };
  });

  return AgentSessionScanner.of({ scan, recentThreads, recentThreadSummaries });
});

export const layer = Layer.effect(AgentSessionScanner, make);
