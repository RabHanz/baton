import {
  CommandId,
  DEFAULT_MODEL,
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  AgentSessionImportProjectChangedError,
  AgentSessionImportProjectNotFoundError,
  AgentSessionImportThreadError,
  AgentSessionSource,
  AgentSessionScanError,
  importedAgentSessionThreadId,
  isImportedAgentSessionMessageId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ThreadId,
  type AgentSessionImportInput,
  type AgentSessionImportResult,
  type AgentSessionImportThreadInput,
  type AgentSessionImportThreadResult,
  type OrchestrationThread,
} from "@t3tools/contracts";
import { normalizeProjectPathForComparison } from "@t3tools/shared/path";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as OrchestrationEngine from "../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ProviderSessionDirectory from "../provider/Services/ProviderSessionDirectory.ts";
import * as AgentSessionScanner from "./AgentSessionScanner.ts";
import { STILL_WRITING_WINDOW_MS } from "./AgentSessionScanner.ts";

const CLAUDE_SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class AgentSessionUnresumableSessionError extends Schema.TaggedError<AgentSessionUnresumableSessionError>()(
  "AgentSessionUnresumableSessionError",
  {
    source: AgentSessionSource,
    providerSessionId: Schema.String,
  },
) {
  override get message(): string {
    return `Session '${this.providerSessionId}' from '${this.source}' cannot be resumed.`;
  }
}

class AgentSessionThreadProjectConflictError extends Schema.TaggedError<AgentSessionThreadProjectConflictError>()(
  "AgentSessionThreadProjectConflictError",
  {
    threadId: ThreadId,
    expectedProjectId: ProjectId,
    actualProjectId: ProjectId,
  },
) {
  override get message(): string {
    return `Imported thread '${this.threadId}' belongs to project '${this.actualProjectId}', not '${this.expectedProjectId}'.`;
  }
}

class AgentSessionThreadModifiedError extends Schema.TaggedError<AgentSessionThreadModifiedError>()(
  "AgentSessionThreadModifiedError",
  { threadId: ThreadId },
) {
  override get message(): string {
    return `Imported thread '${this.threadId}' changed before its history import completed.`;
  }
}

/**
 * What the imported thread says about itself before its first message.
 *
 * A long conversation is imported from its end, and without this line the user
 * is left to guess whether the agent lost the rest. It did not: the resume
 * carries the provider's own session, which is the whole thing.
 */
function importedHistoryNotice(messageCount: number): string {
  return `Showing the last ${messageCount} ${messageCount === 1 ? "message" : "messages"} of this conversation. The agent has the whole thing — resuming continues its own session, with all of the history it already had.`;
}

function hasImportedHistory(thread: OrchestrationThread): boolean {
  return thread.messages.some((message) => isImportedAgentSessionMessageId(message.id));
}

function hasImportBlockingActivity(
  thread: OrchestrationThread,
  importedHistoryPresent: boolean,
): boolean {
  return (
    thread.archivedAt !== null ||
    thread.deletedAt !== null ||
    thread.latestTurn !== null ||
    thread.session !== null ||
    thread.messages.some((message) => !isImportedAgentSessionMessageId(message.id)) ||
    thread.proposedPlans.length > 0 ||
    thread.activities.length > 0 ||
    thread.checkpoints.length > 0 ||
    thread.snoozedUntil != null ||
    thread.snoozedAt != null ||
    thread.pinnedAt != null ||
    thread.pinOrderKey != null ||
    thread.titleRegeneration != null ||
    thread.linkedPullRequest != null ||
    thread.unsettledAt != null ||
    (importedHistoryPresent
      ? thread.settledOverride !== "settled"
      : thread.settledOverride !== null || thread.settledAt !== null)
  );
}

/**
 * Import one conversation: its recent text, and the cursor its CLI resumes from.
 *
 * Shared by the project-wide import and the single-conversation one, which
 * differ only in what they do with a failure — onboarding counts it and moves
 * on, a deliberate pick says so.
 */
const importThreadFromOutcome = Effect.fn("importAgentSessionThread")(function* (input: {
  readonly projectId: ProjectId;
  readonly workspaceRoot: string;
  readonly outcome: Extract<
    AgentSessionScanner.AgentSessionRecentThread,
    { readonly _tag: "Importable" }
  >;
}) {
  const engine = yield* OrchestrationEngine.OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const directory = yield* ProviderSessionDirectory.ProviderSessionDirectory;
  const crypto = yield* Crypto.Crypto;
  const { outcome, workspaceRoot } = input;
  const thread = outcome.thread;
  const threadId = importedAgentSessionThreadId(thread);
  const provider = ProviderDriverKind.make(thread.source);
  const model = thread.model ?? DEFAULT_MODEL_BY_PROVIDER[provider] ?? DEFAULT_MODEL;
  const existingThread = yield* snapshots.getThreadDetailById(threadId);
  const existingBinding = yield* directory.getBinding(threadId);

  if (
    thread.source === "claudeAgent" &&
    !CLAUDE_SESSION_ID_PATTERN.test(thread.providerSessionId)
  ) {
    return yield* new AgentSessionUnresumableSessionError({
      source: thread.source,
      providerSessionId: thread.providerSessionId,
    });
  }

  if (Option.isSome(existingThread) && existingThread.value.projectId !== input.projectId) {
    return yield* new AgentSessionThreadProjectConflictError({
      threadId,
      expectedProjectId: input.projectId,
      actualProjectId: existingThread.value.projectId,
    });
  }

  const importedHistoryPresent = Option.isSome(existingThread)
    ? hasImportedHistory(existingThread.value)
    : false;
  if (Option.isSome(existingThread) && importedHistoryPresent && Option.isSome(existingBinding)) {
    yield* directory.recordImportedTranscript({ threadId, source: outcome.source });
    return true;
  }

  if (
    Option.isSome(existingThread) &&
    hasImportBlockingActivity(existingThread.value, importedHistoryPresent)
  ) {
    return yield* new AgentSessionThreadModifiedError({ threadId });
  }

  if (
    Option.isSome(existingBinding) &&
    (existingBinding.value.provider !== provider ||
      existingBinding.value.providerInstanceId !== thread.providerInstanceId ||
      existingBinding.value.status !== "stopped")
  ) {
    return yield* new AgentSessionThreadModifiedError({ threadId });
  }

  // Install the cursor before the thread becomes visible. A concurrent
  // real session can replace it, while insert-ignore keeps this import
  // from replacing that newer binding.
  if (Option.isNone(existingBinding)) {
    yield* directory.upsert(
      {
        threadId,
        provider,
        providerInstanceId: thread.providerInstanceId,
        status: "stopped",
        runtimeMode: DEFAULT_RUNTIME_MODE,
        resumeCursor:
          thread.source === "codex"
            ? { threadId: thread.providerSessionId }
            : { threadId, resume: thread.providerSessionId },
        runtimePayload: { cwd: workspaceRoot },
      },
      { onConflict: "ignore" },
    );
  }

  if (Option.isNone(existingThread)) {
    yield* engine.dispatch({
      type: "thread.create",
      commandId: CommandId.make(yield* crypto.randomUUIDv4),
      threadId,
      projectId: input.projectId,
      title: thread.title,
      modelSelection: { instanceId: thread.providerInstanceId, model },
      runtimeMode: DEFAULT_RUNTIME_MODE,
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      branch: null,
      worktreePath: null,
      createdAt: thread.createdAt,
      historyImport: true,
    });
  }

  if (!importedHistoryPresent) {
    const history = thread.messages.map((message, index) => ({
      messageId: MessageId.make(`${threadId}:${String(index + 1).padStart(6, "0")}`),
      role: message.role,
      text: message.text,
      createdAt: message.createdAt,
    }));
    yield* engine.dispatch({
      type: "thread.history.import",
      commandId: CommandId.make(yield* crypto.randomUUIDv4),
      threadId,
      messages: thread.historyTruncated
        ? [
            {
              messageId: MessageId.make(`${threadId}:000000`),
              role: "system" as const,
              text: importedHistoryNotice(thread.messages.length),
              createdAt: history[0]?.createdAt ?? thread.createdAt,
            },
            ...history,
          ]
        : history,
    });
  }

  yield* directory.recordImportedTranscript({ threadId, source: outcome.source });

  return true;
});

/**
 * Which refusals a user picking one conversation should be told about by name.
 * Anything else is this server failing, not this conversation being unimportable.
 */
function importThreadFailureReason(cause: unknown): AgentSessionImportThreadError["reason"] | null {
  const tag =
    typeof cause === "object" && cause !== null && "_tag" in cause ? cause._tag : undefined;
  if (tag === "AgentSessionUnresumableSessionError") return "unresumable";
  if (
    tag === "AgentSessionThreadModifiedError" ||
    tag === "AgentSessionThreadProjectConflictError"
  ) {
    return "changed";
  }
  return null;
}

/**
 * Resolve the project an import writes into, and the directory its transcripts
 * must have run in. Both imports refuse a project that moved since the scan.
 */
const resolveImportProject = Effect.fn("resolveAgentSessionImportProject")(function* (input: {
  readonly projectId: ProjectId;
  readonly expectedWorkspaceRoot?: string | undefined;
}) {
  const snapshots = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const project = yield* snapshots.getProjectShellById(input.projectId).pipe(
    Effect.mapError((cause) => new AgentSessionScanError({ operation: "read-projects", cause })),
    Effect.flatMap(
      Option.match({
        onNone: () =>
          Effect.fail(new AgentSessionImportProjectNotFoundError({ projectId: input.projectId })),
        onSome: Effect.succeed,
      }),
    ),
  );
  if (
    input.expectedWorkspaceRoot !== undefined &&
    normalizeProjectPathForComparison(project.workspaceRoot) !==
      normalizeProjectPathForComparison(input.expectedWorkspaceRoot)
  ) {
    return yield* new AgentSessionImportProjectChangedError({ projectId: input.projectId });
  }
  return project.workspaceRoot;
});

/**
 * Import exactly the conversation that was picked.
 *
 * The project-wide import is right for onboarding, where every recent session
 * in a directory is wanted. It is wrong for "resume that one": a folder can
 * hold a transcript that is being written right now, and importing it beside
 * the wanted one puts a second writer one click away.
 */
export const importAgentThread = Effect.fn("importAgentThread")(function* (
  input: AgentSessionImportThreadInput,
) {
  const scanner = yield* AgentSessionScanner.AgentSessionScanner;
  const snapshots = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const workspaceRoot = yield* resolveImportProject(input);
  const threadId = importedAgentSessionThreadId(input);

  // Already here: opening it is the whole action, and re-reading the transcript
  // would only race whatever is writing it now.
  const existingThread = yield* snapshots
    .getThreadShellById(threadId)
    .pipe(
      Effect.mapError((cause) => new AgentSessionScanError({ operation: "read-projects", cause })),
    );
  if (Option.isSome(existingThread) && existingThread.value.projectId === input.projectId) {
    const binding = yield* directoryBinding(threadId);
    if (binding) return { threadId, imported: false } satisfies AgentSessionImportThreadResult;
  }

  // Nested sessions are searched too: the listing shows a project's worktree
  // and package sessions under it, so a conversation the user picked there must
  // be importable. The project-wide import below stays pinned to the root.
  const found = yield* scanner.recentThreads(workspaceRoot, [], true).pipe(
    Stream.filter(
      (outcome) =>
        outcome._tag === "Importable" &&
        outcome.thread.source === input.provider &&
        outcome.thread.providerInstanceId === input.providerInstanceId &&
        outcome.thread.providerSessionId === input.providerSessionId,
    ),
    Stream.take(1),
    Stream.runCollect,
    Effect.map((outcomes) => Array.from(outcomes)[0]),
  );
  if (found === undefined || found._tag !== "Importable") {
    return yield* new AgentSessionImportThreadError({
      providerSessionId: input.providerSessionId,
      reason: "not-found",
    });
  }
  // A transcript written to seconds ago belongs to a session that is still
  // running, and resuming that puts a second writer on the one file holding the
  // conversation. The listing already declines to offer it; this is the rule
  // rather than the courtesy, because the method is callable on its own.
  const quietSinceMs = DateTime.toEpochMillis(yield* DateTime.now) - STILL_WRITING_WINDOW_MS;
  if ((found.source.mtimeMs ?? 0) > quietSinceMs) {
    return yield* new AgentSessionImportThreadError({
      providerSessionId: input.providerSessionId,
      reason: "still-writing",
    });
  }

  yield* importThreadFromOutcome({
    projectId: input.projectId,
    workspaceRoot,
    outcome: found,
  }).pipe(
    // One deliberate pick, so its refusal is named rather than counted.
    Effect.mapError((cause) => {
      const reason = importThreadFailureReason(cause);
      return reason === null
        ? new AgentSessionScanError({ operation: "import-thread", cause })
        : new AgentSessionImportThreadError({
            providerSessionId: input.providerSessionId,
            reason,
          });
    }),
  );

  return { threadId, imported: true } satisfies AgentSessionImportThreadResult;
});

/** Whether the resume cursor for an imported thread is already installed. */
const directoryBinding = Effect.fn("agentSessionImportBinding")(function* (threadId: ThreadId) {
  const directory = yield* ProviderSessionDirectory.ProviderSessionDirectory;
  const binding = yield* directory
    .getBinding(threadId)
    .pipe(
      Effect.mapError((cause) => new AgentSessionScanError({ operation: "read-projects", cause })),
    );
  return Option.isSome(binding);
});

/** Import recent transcript text and persist the cursor needed to resume its provider session. */
export const importRecentAgentThreads = Effect.fn("importRecentAgentThreads")(function* (
  input: AgentSessionImportInput,
) {
  const scanner = yield* AgentSessionScanner.AgentSessionScanner;
  const snapshots = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const directory = yield* ProviderSessionDirectory.ProviderSessionDirectory;
  const workspaceRoot = yield* resolveImportProject(input);
  const completedSources = yield* snapshots
    .getImportedAgentSessionSources(input.projectId)
    .pipe(
      Effect.mapError((cause) => new AgentSessionScanError({ operation: "read-projects", cause })),
    );
  const threads = scanner.recentThreads(
    workspaceRoot,
    completedSources.map((entry) => entry.source),
  );
  const importedThreadIds = new Set<ThreadId>();
  let importedCount = 0;
  let skippedCount = 0;

  yield* Stream.runForEach(threads, (outcome) =>
    Effect.gen(function* () {
      if (outcome._tag === "Skipped") {
        skippedCount += 1;
        return;
      }
      if (outcome._tag === "AlreadyImported" || outcome._tag === "Duplicate") {
        const threadId = importedAgentSessionThreadId(outcome.source);
        if (outcome._tag === "AlreadyImported") {
          importedThreadIds.add(threadId);
          importedCount += 1;
        } else if (importedThreadIds.has(threadId)) {
          const recorded = yield* directory
            .recordImportedTranscript({ threadId, source: outcome.source })
            .pipe(Effect.result);
          if (recorded._tag === "Failure") {
            skippedCount += 1;
            yield* Effect.logWarning("Could not record an imported transcript copy", {
              threadId,
              cause: recorded.failure,
            });
          }
        }
        return;
      }
      const thread = outcome.thread;
      const threadId = importedAgentSessionThreadId(thread);
      const imported = yield* importThreadFromOutcome({
        projectId: input.projectId,
        workspaceRoot,
        outcome,
      }).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Could not import an agent session", {
            provider: thread.source,
            sessionId: thread.providerSessionId,
            cause,
          }).pipe(Effect.as(false)),
        ),
      );

      if (imported) {
        importedThreadIds.add(threadId);
        importedCount += 1;
      } else {
        skippedCount += 1;
      }
    }),
  );

  return { importedCount, skippedCount } satisfies AgentSessionImportResult;
});
