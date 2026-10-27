/* oxlint-disable t3code/no-low-value-comments, t3code/prefer-effect-fn -- Baton file predating upstream's rule (D82) */
// @effect-diagnostics effectFnOpportunity:off flatMapConditionalToFilterOrFail:off preferSchemaOverJson:off instanceOfSchema:off preferSucceedSomeOrNone:off
/**
 * The one place Baton touches upstream's orchestration engine (v2, `orchestration-v2/`).
 *
 * Everything Baton does with T3 threads goes through this service: read thread shells, list
 * projects, notice that a thread changed, start a thread, send a message. When upstream moves its
 * engine again, this file is the port; nothing else in `baton/` imports `orchestration-v2`.
 *
 * Thread ids carry over from v1 unchanged (upstream's legacy importer keeps them), so a work
 * session's stored thread ids stay valid across the move.
 */
import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  MessageId,
  type ModelSelection,
  type OrchestrationProjectShell,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2Run,
  ProjectId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ThreadShell,
  type ProviderInteractionMode,
  type RuntimeMode,
  type ThreadId,
} from "@t3tools/contracts";
import type { BatonSessionStateInput } from "@t3tools/baton-contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import { ProjectService } from "../project/ProjectService.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";

export interface BatonThreadLaunch {
  readonly tag: string;
  /** A client-chosen id, so a retried start is the same thread. */
  readonly threadId?: ThreadId | undefined;
  readonly interactionMode?: ProviderInteractionMode | undefined;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  /** The checkout the work is already in; null starts in the project root. */
  readonly worktreePath: string | null;
  readonly branch: string | null;
  readonly text: string;
}

export interface BatonEngineShape {
  /** Every live (unarchived) thread shell. Empty on an engine error: a fleet read never fails. */
  readonly threadShells: Effect.Effect<ReadonlyArray<OrchestrationV2ThreadShell>>;
  readonly threadShell: (threadId: ThreadId) => Effect.Effect<OrchestrationV2ThreadShell | null>;
  readonly projects: Effect.Effect<ReadonlyArray<OrchestrationProjectShell>>;
  /** The thread each domain event is about, as events arrive. */
  readonly changedThreads: Stream.Stream<ThreadId>;
  /** Upstream's domain events, for the synopsis reactor's own mapping. */
  readonly domainEvents: Stream.Stream<OrchestrationV2DomainEvent>;
  /** The user and assistant messages of the last `userTurns` turns, oldest first. */
  readonly recentMessages: (
    threadId: ThreadId,
    userTurns: number,
  ) => Effect.Effect<ReadonlyArray<{ readonly role: "user" | "assistant"; readonly text: string }>>;
  readonly launchThread: (input: BatonThreadLaunch) => Effect.Effect<ThreadId | null>;
  readonly sendMessage: (input: {
    readonly tag: string;
    readonly threadId: ThreadId;
    readonly text: string;
  }) => Effect.Effect<boolean>;
  /**
   * "Continue with...": the same thread on another provider instance. Upstream's own
   * `provider.switch` builds and delivers the context handoff, so the thread keeps its id and
   * history (this replaced Baton's capsule handoff, D62).
   */
  readonly switchProvider: (input: {
    readonly tag: string;
    readonly threadId: ThreadId;
    readonly modelSelection: ModelSelection;
  }) => Effect.Effect<void, BatonEngineError>;
  /**
   * Live-session threads (D83): append events the way upstream's agent-session import does.
   * Returns how many were stored; 0 when `unlessNativeThreadOwned` found another owner.
   */
  readonly writeEvents: (input: {
    readonly events: ReadonlyArray<OrchestrationV2DomainEvent>;
    readonly unlessNativeThreadOwned?: Parameters<
      EventSink.EventSinkV2["Service"]["write"]
    >[0]["unlessNativeThreadOwned"];
  }) => Effect.Effect<number, BatonEngineError>;
  /** The newest messages of a thread, oldest first. */
  readonly threadMessages: (
    threadId: ThreadId,
    rowLimit: number,
  ) => Effect.Effect<ReadonlyArray<OrchestrationV2ConversationMessage>>;
  /** The thread's runs, for live-session turns (D83). Empty on an engine error. */
  readonly threadRuns: (threadId: ThreadId) => Effect.Effect<ReadonlyArray<OrchestrationV2Run>>;
  /** Upstream's `thread.metadata.update` with a title; false when refused. */
  readonly renameThread: (input: {
    readonly tag: string;
    readonly threadId: ThreadId;
    readonly title: string;
  }) => Effect.Effect<boolean>;
  /** Upstream's `queue.resume`: start a message queued behind a run that just ended. */
  readonly resumeQueue: (input: {
    readonly tag: string;
    readonly threadId: ThreadId;
  }) => Effect.Effect<void>;
  /** A new T3 project for a directory, through upstream's project service; null when refused. */
  readonly createProject: (input: {
    readonly tag: string;
    readonly title: string;
    readonly workspaceRoot: string;
  }) => Effect.Effect<ProjectId | null>;
  /** Upstream's settlement, so a settled work session reads settled in T3's own sidebar. */
  readonly settleThread: (input: {
    readonly tag: string;
    readonly threadId: ThreadId;
  }) => Effect.Effect<boolean>;
}

export class BatonEngineError extends Schema.TaggedError<BatonEngineError>()("BatonEngineError", {
  operation: Schema.String,
  detail: Schema.String,
}) {}

export class BatonEngine extends Context.Service<BatonEngine, BatonEngineShape>()(
  "t3/baton/BatonEngine",
) {}

const iso = (value: DateTime.Utc | null | undefined): string | null =>
  value === null || value === undefined ? null : DateTime.formatIso(value);

/**
 * A v2 thread shell in the words Baton's §10 state ladder uses. Pure, so the mapping is tested
 * on its own and the ladder in `@t3tools/baton-contracts` stays engine-free.
 */
export function batonStateInputFromShell(
  shell: OrchestrationV2ThreadShell,
): BatonSessionStateInput & { readonly updatedAt: string } {
  const request = shell.pendingRuntimeRequest;
  const blocking = request !== null && request.blocking !== false;
  const limited = shell.status === "failed" && shell.lastErrorClass === "usage_limit";
  const sessionStatus: BatonSessionStateInput["sessionStatus"] = (() => {
    switch (shell.status) {
      case "idle":
        return "idle";
      case "preparing":
      case "queued":
      case "starting":
        return "starting";
      case "running":
      case "waiting":
        return "running";
      case "completed":
        return "ready";
      case "interrupted":
      case "cancelled":
      case "rolled_back":
        return "interrupted";
      case "failed":
        // A spent account is `limited`, not `failed`: the ladder reads it from the quota flag.
        return limited ? "stopped" : "error";
    }
  })();
  const latestTurnState: BatonSessionStateInput["latestTurnState"] =
    shell.status === "running" || shell.status === "waiting"
      ? "running"
      : shell.status === "completed"
        ? "completed"
        : shell.status === "failed" && !limited
          ? "error"
          : shell.status === "interrupted" || shell.status === "cancelled"
            ? "interrupted"
            : null;
  return {
    environmentOnline: true,
    hasPendingApprovals: blocking && request.kind !== "user_input",
    hasPendingUserInput: blocking && request.kind === "user_input",
    sessionStatus,
    sessionLastError:
      shell.status === "failed" && !limited ? (shell.lastError ?? "The run failed.") : null,
    backgroundLiveness: (shell.pendingBackgroundTasks?.length ?? 0) > 0 ? "working" : null,
    latestTurnState,
    latestTurnCompletedAt: iso(shell.latestRunCompletedAt),
    lastVisitedAt: iso(shell.lastVisitedAt),
    providerQuotaExhausted: limited,
    updatedAt: DateTime.formatIso(shell.updatedAt),
  };
}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const projectStore = yield* ProjectStore.ProjectStoreV2;
  const launcher = yield* ThreadLaunch.ThreadLaunchService;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const eventSink = yield* EventSink.EventSinkV2;
  const projectService = yield* Effect.serviceOption(ProjectService);
  const crypto = yield* Crypto.Crypto;
  const uuid = crypto.randomUUIDv4().pipe(Effect.orDie);
  const commandId = (tag: string) => Effect.map(uuid, (id) => CommandId.make(`baton:${tag}:${id}`));

  const threadShells = orchestrator.getShellSnapshot().pipe(
    Effect.map((snapshot) => snapshot.threads),
    Effect.catchCause(() => Effect.succeed([] as ReadonlyArray<OrchestrationV2ThreadShell>)),
  );

  const threadShell = (threadId: ThreadId) =>
    orchestrator.getThreadShell(threadId).pipe(Effect.catchCause(() => Effect.succeed(null)));

  const projects = projectStore
    .listShells()
    .pipe(Effect.catchCause(() => Effect.succeed([] as ReadonlyArray<OrchestrationProjectShell>)));

  const domainEvents = orchestrator.streamDomainEvents.pipe(Stream.catchCause(() => Stream.empty));
  const changedThreads = Stream.map(domainEvents, (event) => event.threadId);

  const recentMessages: BatonEngineShape["recentMessages"] = (threadId, userTurns) =>
    orchestrator
      .getThreadSnapshotWindow(threadId, { rowLimit: 400, userTurnLimit: userTurns })
      .pipe(
        Effect.map(({ projection }) =>
          projection.messages.flatMap((message) =>
            (message.role === "user" || message.role === "assistant") &&
            message.text.trim().length > 0
              ? [{ role: message.role, text: message.text }]
              : [],
          ),
        ),
        Effect.catchCause(() => Effect.succeed([])),
      );

  const launchThread = (input: BatonThreadLaunch) =>
    Effect.gen(function* () {
      const result = yield* launcher.launch({
        commandId: yield* commandId(`${input.tag}:launch`),
        ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
        projectId: input.projectId,
        title: input.title,
        modelSelection: input.modelSelection,
        runtimeMode: input.runtimeMode,
        interactionMode: input.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE,
        // The same checkout the work is already in: a reviewer looking at a different tree
        // would be reviewing nothing.
        workspaceStrategy:
          input.worktreePath === null
            ? { type: "root", ...(input.branch === null ? {} : { branch: input.branch }) }
            : {
                type: "existing_worktree",
                worktreePath: input.worktreePath,
                ...(input.branch === null ? {} : { branch: input.branch }),
              },
        ...(input.text.trim().length === 0
          ? {}
          : { initialMessage: { text: input.text, attachments: [] } }),
        createdBy: "system",
        creationSource: "server",
      });
      return result.threadId;
    }).pipe(
      Effect.tapCause((cause) => Effect.logWarning("Baton could not launch a thread", cause)),
      Effect.catchCause(() => Effect.succeed(null)),
    );

  const sendMessage: BatonEngineShape["sendMessage"] = (input) =>
    Effect.gen(function* () {
      const shell = yield* orchestrator.getThreadShell(input.threadId);
      if (shell === null) return false;
      yield* threads.sendToThread({
        projectId: shell.projectId,
        commandId: yield* commandId(`${input.tag}:send`),
        threadId: input.threadId,
        messageId: MessageId.make(`baton-msg-${yield* uuid}`),
        text: input.text,
        attachments: [],
        mode: "auto",
        createdBy: "system",
        creationSource: "server",
      });
      return true;
    }).pipe(
      Effect.tapCause((cause) => Effect.logWarning("Baton could not send to a thread", cause)),
      Effect.catchCause(() => Effect.succeed(false)),
    );

  const switchProvider: BatonEngineShape["switchProvider"] = (input) =>
    Effect.gen(function* () {
      yield* orchestrator.dispatch({
        type: "provider.switch",
        commandId: yield* commandId(`${input.tag}:switch`),
        threadId: input.threadId,
        modelSelection: input.modelSelection,
      });
    }).pipe(
      Effect.mapError(
        (cause) => new BatonEngineError({ operation: "provider.switch", detail: String(cause) }),
      ),
    );

  const settleThread: BatonEngineShape["settleThread"] = (input) =>
    Effect.gen(function* () {
      yield* orchestrator.dispatch({
        type: "thread.settle",
        commandId: yield* commandId(`${input.tag}:settle`),
        threadId: input.threadId,
      });
      return true;
    }).pipe(Effect.catchCause(() => Effect.succeed(false)));

  const writeEvents: BatonEngineShape["writeEvents"] = (input) =>
    eventSink
      .write({
        events: input.events,
        ...(input.unlessNativeThreadOwned === undefined
          ? {}
          : { unlessNativeThreadOwned: input.unlessNativeThreadOwned }),
      })
      .pipe(
        Effect.map((stored) => stored.length),
        Effect.mapError(
          (cause) => new BatonEngineError({ operation: "events.write", detail: String(cause) }),
        ),
      );

  const threadMessages: BatonEngineShape["threadMessages"] = (threadId, rowLimit) =>
    orchestrator.getThreadSnapshotWindow(threadId, { rowLimit }).pipe(
      Effect.map(({ projection }) => projection.messages),
      Effect.catchCause(() => Effect.succeed([])),
    );

  const threadRuns: BatonEngineShape["threadRuns"] = (threadId) =>
    orchestrator.getThreadRecords(threadId, ["runs"]).pipe(
      Effect.map((records) => records.runs),
      Effect.catchCause(() => Effect.succeed([])),
    );

  const renameThread: BatonEngineShape["renameThread"] = (input) =>
    Effect.gen(function* () {
      yield* orchestrator.dispatch({
        type: "thread.metadata.update",
        commandId: yield* commandId(`${input.tag}:rename`),
        threadId: input.threadId,
        title: input.title,
      });
      return true;
    }).pipe(Effect.catchCause(() => Effect.succeed(false)));

  const resumeQueue: BatonEngineShape["resumeQueue"] = (input) =>
    Effect.gen(function* () {
      yield* orchestrator.dispatch({
        type: "queue.resume",
        commandId: yield* commandId(`${input.tag}:queue`),
        threadId: input.threadId,
      });
    }).pipe(Effect.ignoreCause);

  const createProject: BatonEngineShape["createProject"] = (input) =>
    Effect.gen(function* () {
      if (Option.isNone(projectService)) return null;
      const project = yield* projectService.value.create({
        commandId: yield* commandId(`${input.tag}:project`),
        projectId: ProjectId.make(yield* uuid),
        title: input.title,
        workspaceRoot: input.workspaceRoot,
      });
      return project.id;
    }).pipe(
      Effect.tapCause((cause) => Effect.logWarning("Baton could not create a project", cause)),
      Effect.catchCause(() => Effect.succeed(null)),
    );

  return {
    threadShells,
    threadShell,
    writeEvents,
    threadMessages,
    threadRuns,
    renameThread,
    resumeQueue,
    createProject,
    projects,
    changedThreads,
    domainEvents,
    recentMessages,
    launchThread,
    sendMessage,
    switchProvider,
    settleThread,
  } satisfies BatonEngineShape;
});

export const layer = Layer.effect(BatonEngine, make);

/** For tests: an engine with fixed shells and no side effects. */
export const layerStatic = (input: {
  readonly shells?: ReadonlyArray<OrchestrationV2ThreadShell>;
  readonly projects?: ReadonlyArray<OrchestrationProjectShell>;
  readonly launch?: (launch: BatonThreadLaunch) => ThreadId | null;
  readonly sent?: Array<{ readonly threadId: ThreadId; readonly text: string }>;
}) =>
  Layer.succeed(BatonEngine, {
    threadShells: Effect.succeed(input.shells ?? []),
    threadShell: (threadId) =>
      Effect.succeed(
        Option.getOrNull(Option.fromNullishOr((input.shells ?? []).find((s) => s.id === threadId))),
      ),
    projects: Effect.succeed(input.projects ?? []),
    changedThreads: Stream.empty,
    domainEvents: Stream.empty,
    recentMessages: () => Effect.succeed([]),
    launchThread: (launch) => Effect.succeed(input.launch?.(launch) ?? null),
    sendMessage: ({ threadId, text }) =>
      Effect.sync(() => {
        input.sent?.push({ threadId, text });
        return true;
      }),
    switchProvider: () => Effect.void,
    settleThread: () => Effect.succeed(true),
    writeEvents: (write) => Effect.succeed(write.events.length),
    threadMessages: () => Effect.succeed([]),
    threadRuns: () => Effect.succeed([]),
    renameThread: () => Effect.succeed(true),
    resumeQueue: () => Effect.void,
    createProject: () => Effect.succeed(null),
  });
