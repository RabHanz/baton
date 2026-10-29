/* oxlint-disable t3code/no-low-value-comments, t3code/prefer-effect-fn -- Baton file (D82) */
// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalDateInEffect:off preferSchemaOverJson:off effectFnOpportunity:off
/**
 * Every live Claude Code session as an ordinary T3 thread (D83).
 *
 * T3's official apps (phone, desktop, app.t3.codes) render threads from the server's read model
 * and nothing else, so this is where a session started in a plain terminal, VS Code or Herdr has
 * to become one. Each session in the registry (`~/.claude/sessions/<pid>.json`, D68) gets a thread
 * under the T3 project its directory belongs to, written with the same events upstream's own
 * agent-session import writes, and its transcript is followed so new messages arrive as they are
 * written. The thread's provider is the "Live session" instance: T3's own ACP Registry driver
 * running `scripts/baton/live/baton-live-acp.mjs`, so the composer's send becomes a turn that
 * types into the session's Herdr pane (adopting it first when needed).
 *
 * Identity is the Claude conversation id: `baton-live:<session id>`. Account rotation and Herdr
 * adoption both reopen the same conversation id (D69, D74), so the thread stays the same thread.
 * A session T3 already owns (its SDK sessions, or one imported by upstream's importer) is never
 * mirrored a second time.
 *
 * Ordering: runless items sort before every run, so a message written after a composer turn is
 * attached to the thread's latest run and lands after it.
 *
 * D85: pasted images and sent files show (`liveMedia`), each tool call shows as it runs, runs end
 * at once so T3 never queues a send, and the session's working state is a background task on its
 * provider thread, so T3 alerts once when a turn someone asked for has finished.
 *
 * shortcut: polls the registry and each transcript every 2 s rather than watching files; a tick
 * costs a directory read plus one `stat` per live session. Upgrade to fs.watch if ticks show up.
 */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  type ChatAttachment,
  EventId,
  MessageId,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnItemId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type OrchestrationProjectShell,
  type OrchestrationV2AppThread,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2Run,
  RunId,
} from "@t3tools/contracts";
import type { ClaudeLiveSession } from "@t3tools/baton-contracts";
import {
  claudeProjectSlug,
  isComposerEcho,
  parseLiveToolSteps,
  parseLiveTranscriptLine,
  splitTranscriptChunk,
  type LiveToolStep,
  type LiveTranscriptMessage,
} from "@t3tools/baton-shared/liveTranscript";
import { derive as deriveIds } from "@t3tools/provider-core/server/IdAllocator";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";

import {
  chatAttachmentStableKey,
  createDeterministicAttachmentId,
  resolveAttachmentPath,
} from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import { inferImageExtension } from "../imageMime.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { BatonEngine } from "./BatonEngine.ts";
import { readAllProfileLiveSessions } from "./ClaudeLiveSessions.ts";
import { projectRefFor } from "./ProjectRef.ts";

export const LIVE_INSTANCE_ID = ProviderInstanceId.make("baton-live");
const DRIVER = ProviderDriverKind.make("acpRegistry");
const MODEL = "live";
/**
 * Id namespace of live threads. "baton-live" (2026-10-27 rounds 1–2) back-filled older history
 * after newer and so showed it out of order; those threads are deleted at start and rebuilt under
 * this one (they are a mirror of the transcript, which is the record).
 */
const PREFIX = "baton-live4";
/**
 * baton-live2 (round 3 first cut) closed old turns at server start; baton-live3 (round 3) dropped
 * every image and sent file. Both are rebuilt from the transcript.
 */
const RETIRED_PREFIXES = ["baton-live:", "baton-live2:", "baton-live3:"];
const TICK = "2 seconds";
/** How much of an existing transcript a new thread starts with. */
const FIRST_READ_BYTES = 4 * 1024 * 1024;
const FIRST_MESSAGES = 120;
/** How far back a new thread looks for those messages. */
const MAX_BACKFILL_BYTES = 64 * 1024 * 1024;
/** A busy session can write a lot between ticks; one tick reads at most this much. */
const STEP_BYTES = 8 * 1024 * 1024;
/** A turn ends after this long idle: Claude Code can read idle for a moment inside one turn. */
const IDLE_SETTLE_MS = 4_000;
/** The background task that shows a live session working (D85). */
const WORKING_TASK = {
  taskId: "baton-live-turn",
  kind: "background_task" as const,
  description: "Working in its terminal",
};
/** How often a working thread's task is checked against what the runtime last wrote. */
const RECHECK_MS = 10_000;
/** A tool's output shown in the thread is cut to this many characters. */
const MAX_TOOL_OUTPUT_CHARS = 4_000;
/** A sent file bigger than this is named in the thread, not copied. */
const MAX_SENT_FILE_BYTES = 20 * 1024 * 1024;
const INLINE_IMAGE_TYPES: Record<string, string> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};
const FILE_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".json": "application/json",
  ".md": "text/markdown",
  ".mp4": "video/mp4",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
};

const isStep = (entry: LiveTranscriptMessage | LiveToolStep): entry is LiveToolStep =>
  "kind" in entry;

/** A file name as markdown link text: brackets would end the link. */
const label = (name: string): string => name.replace(/[[\]\\]/g, "");

/** What a message shows beyond its words: T3 attachments and, for sent files, markdown. */
export interface LiveMedia {
  readonly text: string;
  readonly attachments: ReadonlyArray<ChatAttachment>;
}

/**
 * Copies a message's media into T3's attachment store (ids from the bytes, so a second mirror of
 * the same message writes nothing new). Pasted images become the user message's own image
 * attachments, which every T3 client renders. Files the session sent go into the assistant
 * message as markdown, because T3 renders an assistant message's images and file links from its
 * markdown: images inline, anything else as a file link. Only what the transcript names is read:
 * the bytes the user pasted, and the paths the session itself chose to send.
 */
export const liveMedia = (input: {
  readonly attachmentsDir: string;
  readonly threadId: string;
  readonly messageId: string;
  readonly message: LiveTranscriptMessage;
}): LiveMedia => {
  const { attachmentsDir, threadId, messageId, message } = input;
  const store = (attachment: ChatAttachment, bytes: Uint8Array): string | null => {
    const path = resolveAttachmentPath({ attachmentsDir, attachment });
    if (path === null) return null;
    if (!NodeFS.existsSync(path)) {
      NodeFS.mkdirSync(attachmentsDir, { recursive: true });
      NodeFS.writeFileSync(path, bytes);
    }
    return path;
  };
  const attachments: Array<ChatAttachment> = [];
  const notes: Array<string> = [];
  (message.images ?? []).forEach((image, index) => {
    const bytes = Buffer.from(image.data, "base64");
    const extension = inferImageExtension({ mimeType: image.mimeType });
    const id = createDeterministicAttachmentId(
      threadId,
      chatAttachmentStableKey(messageId, index, bytes),
    );
    if (id === null || bytes.length === 0) return;
    if (bytes.length > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
      notes.push(
        `_An image (${Math.round(bytes.length / 1_048_576)} MB) is too big to show here._`,
      );
      return;
    }
    const attachment: ChatAttachment = {
      type: "image",
      id,
      name: `image-${index + 1}${extension}`,
      mimeType: image.mimeType,
      sizeBytes: bytes.length,
    };
    if (store(attachment, bytes) !== null) attachments.push(attachment);
  });
  const links: Array<string> = [];
  (message.files ?? []).forEach((file, index) => {
    const name = NodePath.basename(file);
    let stat: NodeFS.Stats | null = null;
    try {
      stat = NodeFS.statSync(file);
    } catch {}
    if (stat === null || !stat.isFile()) {
      notes.push(`_${label(name)} is no longer on disk._`);
      return;
    }
    if (stat.size === 0 || stat.size > MAX_SENT_FILE_BYTES) {
      notes.push(`_${label(name)} (${Math.round(stat.size / 1_048_576)} MB) is not copied here._`);
      return;
    }
    const bytes = NodeFS.readFileSync(file);
    const extension = NodePath.extname(name).toLowerCase();
    const id = createDeterministicAttachmentId(
      threadId,
      chatAttachmentStableKey(messageId, index, bytes),
    );
    if (id === null) return;
    const imageType = INLINE_IMAGE_TYPES[extension];
    const attachment: ChatAttachment =
      imageType !== undefined && bytes.length <= PROVIDER_SEND_TURN_MAX_IMAGE_BYTES
        ? { type: "image", id, name, mimeType: imageType, sizeBytes: bytes.length }
        : {
            type: "file",
            id,
            name,
            mimeType: FILE_TYPES[extension] ?? "application/octet-stream",
            sizeBytes: bytes.length,
          };
    const copy = store(attachment, bytes);
    if (copy === null) return;
    links.push(
      attachment.type === "image" ? `![${label(name)}](<${copy}>)` : `[${label(name)}](<${copy}>)`,
    );
  });
  const text = [message.text, ...links, ...notes].filter((part) => part.length > 0).join("\n\n");
  // Sent files live in the markdown; only a user message carries T3 attachments.
  return { text, attachments: message.role === "user" ? attachments : [] };
};

/** Off by machine with `BATON_LIVE_THREADS=off`. */
export const liveThreadsEnabled = (): boolean => process.env.BATON_LIVE_THREADS !== "off";

export const liveThreadId = (sessionId: string): ThreadId =>
  ThreadId.make(`${PREFIX}:${sessionId}`);

const agentScript = (): string =>
  process.env.BATON_LIVE_ACP ??
  NodePath.join(NodeOS.homedir(), ".t3", "baton", "baton-live-acp.mjs");

/** A Node for the agent: T3 itself is a single executable, so it cannot run a script. */
export const findNode = (): string | null => {
  const home = NodeOS.homedir();
  const nvm = NodePath.join(home, ".nvm", "versions", "node");
  let nvmNodes: Array<string> = [];
  try {
    nvmNodes = NodeFS.readdirSync(nvm)
      .toSorted((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      .map((version) => NodePath.join(nvm, version, "bin", "node"));
  } catch {}
  const candidates = [
    process.env.BATON_LIVE_NODE,
    NodePath.join(home, ".t3", "baton", "node"),
    NodePath.join(home, "bin", "node"),
    ...nvmNodes,
    "/usr/local/bin/node",
    "/usr/bin/node",
  ];
  for (const candidate of candidates) {
    if (candidate === undefined || candidate.length === 0) continue;
    try {
      NodeFS.accessSync(candidate, NodeFS.constants.X_OK);
      return candidate;
    } catch {}
  }
  return null;
};

/** The project a session's directory belongs to: deepest root that contains it, then same repo. */
export const projectForDirectory = (
  cwd: string,
  projects: ReadonlyArray<
    Pick<OrchestrationProjectShell, "id" | "workspaceRoot" | "repositoryIdentity">
  >,
  repositoryKey: string | null,
): ProjectId | null => {
  const inside = projects
    .filter(
      (p) => cwd === p.workspaceRoot || cwd.startsWith(`${p.workspaceRoot.replace(/\/$/, "")}/`),
    )
    .toSorted((a, b) => b.workspaceRoot.length - a.workspaceRoot.length);
  if (inside[0] !== undefined) return inside[0].id;
  if (repositoryKey === null) return null;
  return projects.find((p) => p.repositoryIdentity?.canonicalKey === repositoryKey)?.id ?? null;
};

/** The box, as the official apps' environment list names it: the host's first label. */
const box = (): string => NodeOS.hostname().split(".")[0] ?? NodeOS.hostname();

/**
 * The thread title the official apps show: the session's own name, then the account and box it
 * runs on. T3 renders only the title in its thread lists, so that is where they go.
 */
export const liveThreadTitle = (input: {
  readonly name: string;
  readonly account: string | null;
  readonly box: string;
}): string =>
  [input.name.trim().slice(0, 60) || "Live session", input.account, input.box]
    .filter((part): part is string => part !== null && part.length > 0)
    .join(" · ");

/** Claude Code keeps a conversation at `<config>/projects/<slug>/<id>.jsonl`. */
const transcriptPath = (session: ClaudeLiveSession): string | null => {
  const root = NodePath.join(
    session.configDir ?? NodePath.join(NodeOS.homedir(), ".claude"),
    "projects",
  );
  const direct = NodePath.join(root, claudeProjectSlug(session.cwd), `${session.sessionId}.jsonl`);
  if (NodeFS.existsSync(direct)) return direct;
  try {
    for (const dir of NodeFS.readdirSync(root)) {
      const candidate = NodePath.join(root, dir, `${session.sessionId}.jsonl`);
      if (NodeFS.existsSync(candidate)) return candidate;
    }
  } catch {}
  return null;
};

const readRange = (path: string, from: number, to: number): string => {
  const fd = NodeFS.openSync(path, "r");
  try {
    const buffer = Buffer.alloc(Math.max(0, to - from));
    const read = NodeFS.readSync(fd, buffer, 0, buffer.length, from);
    return buffer.subarray(0, read).toString("utf8");
  } finally {
    NodeFS.closeSync(fd);
  }
};

interface Follow {
  readonly threadId: ThreadId;
  path: string | null;
  offset: number;
  rest: string;
  readonly written: Set<string>;
  /** The session's own name, once a first user message has given it one. */
  name: string | null;
  /** Where assistant messages go: the turn the last user message started (Baton's or T3's). */
  target: RunId | null;
  /** A terminal turn Baton opened that is still running. */
  open: OrchestrationV2Run | null;
  /** When the newest mirrored message was written: a finished turn ends there, not at "now". */
  lastAt: DateTime.Utc | null;
  /** Since when the session has read idle while a terminal turn is open. */
  idleSince: number | null;
  /** A user message is being worked on (from it until the session has been idle a while). */
  turn: boolean;
  /** What the thread last showed: working or not (null until read). */
  shown: boolean | null;
  checkedAt: number;
  /** Tool calls shown as running, by Claude's tool-use id, until their result arrives. */
  readonly tools: Map<
    string,
    { readonly name: string; readonly input: unknown; readonly at: string }
  >;
}

const make = Effect.gen(function* () {
  const engine = yield* BatonEngine;
  const settings = yield* ServerSettingsService;
  const { attachmentsDir } = yield* ServerConfig.ServerConfig;

  const follows = new Map<string, Follow>();
  /** Sessions another T3 thread owns, so Baton stays out of them. */
  const owned = new Set<string>();

  const ensureProviderInstance = Effect.gen(function* () {
    const script = agentScript();
    const node = findNode();
    if (!NodeFS.existsSync(script) || node === null) {
      yield* Effect.logWarning("Baton live threads: no agent script or Node, sending is off", {
        script,
        node,
      });
      return;
    }
    const wanted = {
      driver: DRIVER,
      displayName: "Live session",
      enabled: true,
      config: { source: "local", commandPath: node, commandArgs: [script], customModels: [MODEL] },
    };
    const current = (yield* settings.getSettings).providerInstances[LIVE_INSTANCE_ID];
    if (JSON.stringify(current) === JSON.stringify(wanted)) return;
    yield* settings.updateProviderInstance({
      operation: "upsert",
      instanceId: LIVE_INSTANCE_ID,
      instance: wanted,
    });
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("Baton live threads: provider setup failed", cause),
    ),
  );

  const projectFor = (session: ClaudeLiveSession) =>
    Effect.gen(function* () {
      const projects = yield* engine.projects;
      const { key: repositoryRef, label } = yield* projectRefFor(session.cwd);
      const repositoryKey = repositoryRef.startsWith("dir:") ? null : repositoryRef;
      const found = projectForDirectory(session.cwd, projects, repositoryKey);
      if (found !== null) return { projectId: found, projects };
      const created = yield* engine.createProject({
        tag: "live",
        title: label,
        workspaceRoot: session.cwd,
      });
      return { projectId: created, projects: yield* engine.projects };
    });

  const createThread = (session: ClaudeLiveSession, threadId: ThreadId, title: string) =>
    Effect.gen(function* () {
      const { projectId, projects } = yield* projectFor(session);
      if (projectId === null) return;
      const project = projects.find((p) => p.id === projectId);
      const now = yield* DateTime.now;
      const providerThreadId = deriveIds.providerThread({
        driver: DRIVER,
        providerInstanceId: LIVE_INSTANCE_ID,
        nativeThreadId: session.sessionId,
      });
      const root = project?.workspaceRoot ?? session.cwd;
      const appThread: OrchestrationV2AppThread = {
        createdBy: "system",
        creationSource: "server",
        id: threadId,
        projectId,
        title,
        providerInstanceId: LIVE_INSTANCE_ID,
        modelSelection: { instanceId: LIVE_INSTANCE_ID, model: MODEL },
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        branch: null,
        worktreePath: session.cwd === root ? null : session.cwd,
        linkedPullRequest: null,
        branchPullRequest: null,
        activeProviderThreadId: providerThreadId,
        // Runless items are history, the same as upstream's import.
        historyOrigin: "v1_import",
        lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
        forkedFrom: null,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        unsettledAt: null,
        snoozedUntil: null,
        snoozedAt: null,
        pinnedAt: null,
        pinOrderKey: null,
        activeOrderKey: null,
        lastVisitedAt: null,
        deletedAt: null,
      };
      const providerThread: OrchestrationV2ProviderThread = {
        id: providerThreadId,
        driver: DRIVER,
        providerInstanceId: LIVE_INSTANCE_ID,
        providerSessionId: null,
        appThreadId: threadId,
        ownerNodeId: null,
        nativeThreadRef: { driver: DRIVER, nativeId: session.sessionId, strength: "strong" },
        nativeConversationHeadRef: null,
        status: "idle",
        firstRunOrdinal: null,
        lastRunOrdinal: null,
        handoffIds: [],
        forkedFrom: null,
        pendingBackgroundTasks: [],
        createdAt: now,
        updatedAt: now,
      };
      // No `unlessNativeThreadOwned`: the only other owner of this native id under this instance
      // is a retired mirror thread, which is deleted, not a conversation T3 runs.
      yield* engine.writeEvents({
        events: [
          {
            id: EventId.make(`${PREFIX}:thread:${threadId}:created`),
            type: "thread.created",
            threadId,
            providerInstanceId: LIVE_INSTANCE_ID,
            occurredAt: now,
            payload: appThread,
          },
          {
            id: EventId.make(`${PREFIX}:provider-thread:${providerThreadId}`),
            type: "provider-thread.updated",
            threadId,
            driver: DRIVER,
            providerInstanceId: LIVE_INSTANCE_ID,
            occurredAt: now,
            payload: providerThread,
          },
        ],
      });
    });

  const messageEvents = (
    threadId: ThreadId,
    sessionId: string,
    message: LiveTranscriptMessage,
    runId: RunId | null,
    media?: LiveMedia,
  ): ReadonlyArray<OrchestrationV2DomainEvent> => {
    const key = `${sessionId}:${message.uuid}`;
    const messageId = MessageId.make(`${PREFIX}:${key}`);
    const { text, attachments } =
      media ?? liveMedia({ attachmentsDir, threadId, messageId, message });
    const at = DateTime.makeUnsafe(message.createdAt);
    const common = {
      id: TurnItemId.make(`${PREFIX}:turn-item:${key}`),
      threadId,
      runId,
      nodeId: null,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      // The position store replaces this with the next place in the thread.
      ordinal: 1,
      status: "completed" as const,
      title: null,
      startedAt: at,
      completedAt: at,
      updatedAt: at,
    };
    return [
      {
        id: EventId.make(`${PREFIX}:message:${key}`),
        type: "message.updated",
        threadId,
        occurredAt: at,
        payload: {
          createdBy: message.role === "user" ? "user" : "agent",
          creationSource: "server",
          id: messageId,
          threadId,
          runId,
          nodeId: null,
          role: message.role,
          text,
          attachments,
          streaming: false,
          createdAt: at,
          updatedAt: at,
        },
      },
      {
        id: EventId.make(`${PREFIX}:turn-item:${key}`),
        type: "turn-item.updated",
        threadId,
        occurredAt: at,
        payload:
          message.role === "user"
            ? {
                ...common,
                createdBy: "user",
                creationSource: "server",
                type: "user_message",
                messageId,
                inputIntent: "turn_start",
                text,
                attachments,
              }
            : {
                ...common,
                type: "assistant_message",
                messageId,
                text,
                streaming: false,
              },
      },
    ];
  };

  /**
   * A tool step as the turn item upstream's Claude adapter would write for it: `Bash` as a command,
   * anything else as a named tool. A call shows running until its result replaces it in place.
   */
  const toolEvents = (
    follow: Follow,
    sessionId: string,
    step: LiveToolStep,
    runId: RunId | null,
  ): ReadonlyArray<OrchestrationV2DomainEvent> => {
    const call =
      step.kind === "use"
        ? { name: step.name, input: step.input, at: step.createdAt }
        : follow.tools.get(step.id);
    if (call === undefined) return [];
    if (step.kind === "use") follow.tools.set(step.id, call);
    else follow.tools.delete(step.id);
    const done = step.kind === "result";
    const output = done ? step.output.slice(0, MAX_TOOL_OUTPUT_CHARS) : undefined;
    const startedAt = DateTime.makeUnsafe(call.at);
    const at = DateTime.makeUnsafe(step.createdAt);
    const input = (call.input ?? {}) as Record<string, unknown>;
    const id = TurnItemId.make(`${PREFIX}:tool:${sessionId}:${step.id}`);
    const common = {
      id,
      threadId: follow.threadId,
      runId,
      nodeId: null,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal: 1,
      status: done
        ? step.isError
          ? ("failed" as const)
          : ("completed" as const)
        : ("running" as const),
      title: call.name,
      startedAt,
      completedAt: done ? at : null,
      updatedAt: at,
    };
    return [
      {
        id: EventId.make(`${PREFIX}:tool:${sessionId}:${step.id}:${step.kind}`),
        type: "turn-item.updated",
        threadId: follow.threadId,
        occurredAt: at,
        payload:
          call.name === "Bash" && typeof input["command"] === "string"
            ? {
                ...common,
                type: "command_execution",
                input: input["command"],
                ...(output === undefined ? {} : { output }),
                ...(done && step.isError ? { outputIndicatesFailure: true } : {}),
              }
            : {
                ...common,
                type: "dynamic_tool",
                toolName: call.name,
                input: call.input ?? {},
                ...(output === undefined ? {} : { output }),
              },
      },
    ];
  };

  /** Messages the thread already shows: Baton's own copies, and what T3's composer sent. */
  const threadMessages = (threadId: ThreadId) => engine.threadMessages(threadId, 400);

  const runEvent = (
    type: "run.created" | "run.updated",
    run: OrchestrationV2Run,
  ): OrchestrationV2DomainEvent => ({
    id: EventId.make(`${PREFIX}:${type}:${run.id}:${run.status}:${Date.now()}`),
    type,
    threadId: run.threadId,
    occurredAt: run.completedAt ?? run.startedAt ?? run.requestedAt,
    payload: run,
  });

  const completeRun = (run: OrchestrationV2Run, at: DateTime.Utc): OrchestrationV2Run => ({
    ...run,
    status: "completed",
    completedAt: at,
  });

  /**
   * Transcript messages into the thread. A user message typed in the terminal opens its own turn
   * (a run, so the official apps show it as a turn and the thread as Working while it runs);
   * the copy of a message T3's composer sent is skipped and its replies join that composer turn.
   * Live, a message typed while a terminal turn is still running joins that turn, so the turn
   * ends (and alerts) once, when the session goes idle; history keeps one turn per message.
   */
  const writeMessages = (
    follow: Follow,
    session: ClaudeLiveSession,
    entries: ReadonlyArray<LiveTranscriptMessage | LiveToolStep>,
    history = false,
  ) =>
    Effect.gen(function* () {
      // Tool steps only live: history shows the conversation, not every call it made.
      const fresh = entries.filter((e) => (isStep(e) ? !history : !follow.written.has(e.uuid)));
      if (fresh.length === 0) return;
      const runs = yield* engine.threadRuns(follow.threadId);
      let ordinal = runs.reduce((max, run) => Math.max(max, run.ordinal), 0);
      const latest = runs.reduce<OrchestrationV2Run | null>(
        (best, run) => (best === null || run.ordinal > best.ordinal ? run : best),
        null,
      );
      follow.target ??= latest?.id ?? null;
      const existing = fresh.some((m) => !isStep(m) && m.role === "user")
        ? yield* threadMessages(follow.threadId)
        : [];
      const composerSent = existing.filter(
        (m) => m.role === "user" && !String(m.id).startsWith(`${PREFIX}:`),
      );
      const events: Array<OrchestrationV2DomainEvent> = [];
      // A reply belongs to the newest turn asked for before it: sends typed into a busy session
      // are read by Claude Code together, and its answer follows the last of them.
      const known = [...runs];
      const ownerAt = (iso: string) => {
        const owner = known
          .filter((run) => DateTime.toEpochMillis(run.requestedAt) <= Date.parse(iso))
          .reduce<OrchestrationV2Run | null>(
            (best, run) => (best === null || run.ordinal > best.ordinal ? run : best),
            null,
          );
        if (owner !== null) follow.target = owner.id;
      };
      for (const message of fresh) {
        if (isStep(message)) {
          ownerAt(message.createdAt);
          events.push(...toolEvents(follow, session.sessionId, message, follow.target));
          continue;
        }
        if (message.role === "assistant") ownerAt(message.createdAt);
        follow.written.add(message.uuid);
        const at = DateTime.makeUnsafe(message.createdAt);
        follow.lastAt = at;
        if (message.role === "user") {
          const echo = composerSent.find(
            (sent) =>
              isComposerEcho(message.text, sent.text) &&
              Math.abs(DateTime.toEpochMillis(sent.createdAt) - Date.parse(message.createdAt)) <
                15 * 60_000,
          );
          if (follow.open !== null) {
            events.push(runEvent("run.updated", completeRun(follow.open, at)));
            follow.open = null;
          }
          // Someone asked for something: the session works on it until it is idle again.
          if (!history) {
            follow.turn = true;
            follow.idleSince = null;
          }
          if (echo !== undefined) {
            follow.target = echo.runId ?? latest?.id ?? follow.target;
            continue;
          }
          follow.name ??= message.text.split("\n")[0] ?? null;
          ordinal += 1;
          const run: OrchestrationV2Run = {
            id: RunId.make(`${PREFIX}:run:${session.sessionId}:${message.uuid}`),
            threadId: follow.threadId,
            ordinal,
            providerInstanceId: LIVE_INSTANCE_ID,
            modelSelection: { instanceId: LIVE_INSTANCE_ID, model: MODEL },
            providerThreadId: null,
            userMessageId: MessageId.make(`${PREFIX}:${session.sessionId}:${message.uuid}`),
            rootNodeId: null,
            activeAttemptId: null,
            // Live, the run is the turn's record and ends at once: a running run makes T3 queue
            // every later send. The working state is the provider thread's (see `working`).
            status: history ? "running" : "completed",
            requestedAt: at,
            startedAt: at,
            completedAt: history ? null : at,
            checkpointId: null,
            contextHandoffId: null,
          };
          events.push(runEvent("run.created", run));
          known.push(run);
          if (history) follow.open = run;
          follow.target = run.id;
        }
        events.push(...messageEvents(follow.threadId, session.sessionId, message, follow.target));
      }
      if (events.length > 0) yield* engine.writeEvents({ events });
    });

  /**
   * A thread with no turns yet (history mirrored before D83 round 2) gets a finished one around
   * its last user message, so it does not read as waiting on anyone.
   */
  const ensureTurn = (follow: Follow, session: ClaudeLiveSession) =>
    Effect.gen(function* () {
      if ((yield* engine.threadRuns(follow.threadId)).length > 0) return;
      const now = yield* DateTime.now;
      const messages = yield* threadMessages(follow.threadId);
      const lastUser = messages.findLastIndex(
        (m) => m.role === "user" && String(m.id).startsWith(`${PREFIX}:`),
      );
      if (lastUser < 0) return;
      const user = messages[lastUser]!;
      const uuid = String(user.id).slice(String(user.id).lastIndexOf(":") + 1);
      const run: OrchestrationV2Run = {
        id: RunId.make(`${PREFIX}:run:${session.sessionId}:${uuid}`),
        threadId: follow.threadId,
        ordinal: 1,
        providerInstanceId: LIVE_INSTANCE_ID,
        modelSelection: { instanceId: LIVE_INSTANCE_ID, model: MODEL },
        providerThreadId: null,
        userMessageId: user.id,
        rootNodeId: null,
        activeAttemptId: null,
        status: "completed",
        requestedAt: user.createdAt,
        startedAt: user.createdAt,
        completedAt: messages.at(-1)?.createdAt ?? now,
        checkpointId: null,
        contextHandoffId: null,
      };
      // The same messages, now inside the turn (new event ids; message and item ids unchanged).
      const rehomed = messages.slice(lastUser).flatMap((m) =>
        String(m.id).startsWith(`${PREFIX}:`) && (m.role === "user" || m.role === "assistant")
          ? messageEvents(
              follow.threadId,
              session.sessionId,
              {
                uuid: String(m.id).slice(String(m.id).lastIndexOf(":") + 1),
                role: m.role,
                text: m.text,
                createdAt: DateTime.formatIso(m.createdAt),
              },
              run.id,
              { text: m.text, attachments: m.attachments ?? [] },
            ).map((event) => ({ ...event, id: EventId.make(`${event.id}:turn`) }))
          : [],
      );
      yield* engine.writeEvents({ events: [runEvent("run.created", run), ...rehomed] });
      follow.target = run.id;
    });

  /** History's last turn ends at its last message. */
  const closeHistory = (follow: Follow) =>
    Effect.gen(function* () {
      if (follow.open === null) return;
      const done = completeRun(follow.open, follow.lastAt ?? (yield* DateTime.now));
      follow.open = null;
      yield* engine.writeEvents({ events: [runEvent("run.updated", done)] });
    });

  /**
   * Working, the way T3 shows a turn whose agent still has work out: a background task on the
   * provider thread, from a user message until the session has been idle a few seconds. Its
   * runs are already finished, so T3 never queues a send behind it, and T3 sends one "completed"
   * alert when the task clears. Work with no user message (a background agent's report) is not
   * a turn and does not alert. Re-asserted every few seconds: the agent's own runtime rewrites
   * the provider thread when a composer send goes through.
   */
  const working = (follow: Follow, session: ClaudeLiveSession) =>
    Effect.gen(function* () {
      const busy = session.status === "busy";
      if (busy) follow.idleSince = null;
      else if (follow.turn) {
        follow.idleSince ??= Date.now();
        if (Date.now() - follow.idleSince >= IDLE_SETTLE_MS) follow.turn = false;
      }
      const want = follow.turn;
      if (want === follow.shown && (!want || Date.now() - follow.checkedAt < RECHECK_MS)) return;
      follow.checkedAt = Date.now();
      const provider = yield* engine.activeProviderThread(follow.threadId);
      if (provider === null) return;
      const others = (provider.pendingBackgroundTasks ?? []).filter(
        (task) => task.taskId !== WORKING_TASK.taskId,
      );
      const has = others.length !== (provider.pendingBackgroundTasks ?? []).length;
      // A changed state is always written: the read can lag the last write, and a skipped clear
      // would leave the thread working (and its alert unsent) for good. A recheck writes only
      // when the task is missing.
      const changed = want !== follow.shown;
      follow.shown = want;
      if (!changed && has === want) return;
      const now = yield* DateTime.now;
      yield* engine.writeEvents({
        events: [
          {
            id: EventId.make(`${PREFIX}:working:${follow.threadId}:${want}:${Date.now()}`),
            type: "provider-thread.updated",
            threadId: follow.threadId,
            driver: provider.driver,
            providerInstanceId: provider.providerInstanceId,
            occurredAt: now,
            payload: {
              ...provider,
              pendingBackgroundTasks: want ? [...others, WORKING_TASK] : others,
              updatedAt: now,
            },
          },
        ],
      });
      if (!want) yield* engine.resumeQueue({ tag: "live", threadId: follow.threadId });
    });

  /** Keep the session's own title, with its account and box; T3's auto-title does not stick. */
  const retitle = (follow: Follow, session: ClaudeLiveSession) =>
    Effect.gen(function* () {
      const shell = yield* engine.threadShell(follow.threadId);
      // Claude Code derives a fresh name on every restart (rotation, adoption); a thread keeps the
      // name it was first given unless someone names the session.
      const kept = shell?.title.includes(" · ") ? shell.title.split(" · ")[0] : undefined;
      const name =
        session.nameSource === "user"
          ? (session.name ?? kept)
          : (kept ?? session.name ?? follow.name ?? undefined);
      const wanted = liveThreadTitle({
        name: name ?? "Live session",
        account: session.account,
        box: box(),
      });
      if (shell !== null && shell.title !== wanted && shell.titleRegeneration == null) {
        yield* engine.renameThread({ tag: "live", threadId: follow.threadId, title: wanted });
      }
    });

  const startFollowing = (session: ClaudeLiveSession) =>
    Effect.gen(function* () {
      const threadId = liveThreadId(session.sessionId);
      const path = transcriptPath(session);
      const size = path === null ? 0 : NodeFS.statSync(path).size;
      // Long tool-heavy sessions hold few messages per megabyte: read back until there are enough.
      let from = size;
      let history: Array<LiveTranscriptMessage> = [];
      while (
        path !== null &&
        from > 0 &&
        history.length < FIRST_MESSAGES &&
        size - from < MAX_BACKFILL_BYTES
      ) {
        from = Math.max(0, from - FIRST_READ_BYTES);
        const chunk = readRange(path, from, size);
        // A read from the middle of the file starts mid-record; the first line is dropped.
        const lines = splitTranscriptChunk(chunk).lines.slice(from > 0 ? 1 : 0);
        history = lines.flatMap((line) => parseLiveTranscriptLine(line) ?? []);
      }
      history = history.slice(-FIRST_MESSAGES);
      const shell = yield* engine.threadShell(threadId);
      if (shell === null) {
        const firstUser = history.find((m) => m.role === "user")?.text.split("\n")[0];
        yield* createThread(
          session,
          threadId,
          liveThreadTitle({
            name: session.name ?? firstUser ?? "Live session",
            account: session.account,
            box: box(),
          }),
        );
        if ((yield* engine.threadShell(threadId)) === null) {
          owned.add(session.sessionId); // another thread holds this native session
          return;
        }
      }
      const mirrored = (yield* threadMessages(threadId)).filter((m) =>
        String(m.id).startsWith(`${PREFIX}:`),
      );
      const known = new Set(
        mirrored.map((m) => String(m.id).slice(String(m.id).lastIndexOf(":") + 1)),
      );
      // An existing thread only takes what is newer than its newest message: anything older
      // written now would sort after it.
      const newest = mirrored.reduce(
        (max, m) => Math.max(max, DateTime.toEpochMillis(m.createdAt)),
        Number.NEGATIVE_INFINITY,
      );
      if (shell !== null) history = history.filter((m) => Date.parse(m.createdAt) > newest);
      const follow: Follow = {
        threadId,
        path,
        offset: size,
        rest: "",
        written: known,
        name: history.find((m) => m.role === "user")?.text.split("\n")[0] ?? null,
        target: null,
        open: null,
        lastAt: null,
        idleSince: null,
        // A session busy when Baton starts is taken to be working on something.
        turn: session.status === "busy",
        shown: null,
        checkedAt: 0,
        tools: new Map(),
      };
      follows.set(session.sessionId, follow);
      // A running session is never filed away for age. Settling it by hand is the per-thread mute
      // (T3's relay sends no alert for a settled thread), so Baton leaves that alone.
      yield* engine.keepActive({ tag: "live", threadId, settled: false });
      // What the thread lacks from the transcript's tail: all of it the first time, and after a
      // restart whatever arrived while the server was down. History turns are finished turns.
      yield* writeMessages(follow, session, history, true);
      yield* closeHistory(follow);
      yield* ensureTurn(follow, session);
      yield* working(follow, session);
    });

  const step = (session: ClaudeLiveSession, follow: Follow) =>
    Effect.gen(function* () {
      follow.path ??= transcriptPath(session);
      if (follow.path === null) return;
      const size = NodeFS.statSync(follow.path).size;
      if (size < follow.offset) {
        follow.offset = 0; // rewritten: read it again; uuids keep it idempotent
        follow.rest = "";
      }
      if (size === follow.offset) return;
      const to = Math.min(size, follow.offset + STEP_BYTES);
      const { lines, rest } = splitTranscriptChunk(
        follow.rest + readRange(follow.path, follow.offset, to),
      );
      follow.offset = to;
      follow.rest = rest;
      yield* writeMessages(
        follow,
        session,
        lines.flatMap((line) => [
          ...parseLiveToolSteps(line),
          ...[parseLiveTranscriptLine(line)].filter((m) => m !== null),
        ]),
      );
    });

  /** Delete the retired namespace's threads once, so each session has one thread. */
  const retireOld = Effect.gen(function* () {
    for (const shell of yield* engine.threadShells) {
      if (RETIRED_PREFIXES.some((prefix) => String(shell.id).startsWith(prefix))) {
        yield* engine.deleteThread({ tag: "live", threadId: shell.id });
      }
    }
  });

  const tick = Effect.gen(function* () {
    const live = yield* readAllProfileLiveSessions();
    const fresh = live.filter((s) => !follows.has(s.sessionId) && !owned.has(s.sessionId));
    if (fresh.length > 0) {
      // A session upstream's importer copied is a snapshot, not the live conversation: the live
      // thread replaces it, and an import nobody continued (no turns) is archived (reversible).
      // An import someone continued in T3 is T3's own thread now, so Baton stays out of it.
      const shells = yield* engine.threadShells;
      for (const session of fresh) {
        const imported = shells.find(
          (t) =>
            String(t.id).startsWith("import:") && String(t.id).endsWith(`:${session.sessionId}`),
        );
        if (imported === undefined) continue;
        if (imported.latestRunId !== null) owned.add(session.sessionId);
        else yield* engine.archiveThread({ tag: "live", threadId: imported.id });
      }
    }
    yield* Effect.forEach(
      live.filter((s) => !owned.has(s.sessionId)),
      (session) => {
        const follow = follows.get(session.sessionId);
        return (
          follow === undefined
            ? startFollowing(session)
            : step(session, follow).pipe(
                Effect.andThen(working(follow, session)),
                Effect.andThen(retitle(follow, session)),
              )
        ).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Baton live threads: a session could not be mirrored", {
              sessionId: session.sessionId,
              cause,
            }).pipe(
              // Start over from the thread's own state next tick rather than guess.
              Effect.tap(() => Effect.sync(() => follows.delete(session.sessionId))),
            ),
          ),
        );
      },
      { discard: true },
    );
  });

  if (!liveThreadsEnabled()) return;
  yield* ensureProviderInstance;
  yield* retireOld.pipe(
    Effect.catchCause((cause) => Effect.logWarning("Baton live threads: retiring failed", cause)),
  );
  yield* tick.pipe(
    Effect.catchCause((cause) => Effect.logWarning("Baton live threads: tick failed", cause)),
    Effect.repeat(Schedule.spaced(TICK)),
    Effect.forkScoped,
  );
});

export const layer = Layer.effectDiscard(make);
