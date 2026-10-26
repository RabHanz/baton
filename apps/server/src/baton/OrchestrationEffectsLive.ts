/**
 * What a rule is allowed to do when it fires.
 *
 * Deliberately a small, named surface rather than "the reactor can reach the
 * orchestration engine". A rule can start a provider session, message the
 * active implementation thread, and record a notification. It cannot archive,
 * delete, settle, push, or touch anything outside its own work session, and
 * the way to keep that true is for the list to be short and to live in one
 * file.
 *
 * Every thread a rule creates goes through the same `thread.create` command a
 * client would dispatch — the one thread-creation path Phase 2 established —
 * and is attached to the work session with `origin: created`, so the timeline
 * shows that a rule made it rather than a person.
 */
import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  isProviderAvailable,
  MessageId,
  ThreadId,
  type OrchestrationAction,
  type WorkSessionId,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import { normalizeDispatchCommand } from "../orchestration/Normalizer.ts";
import * as OrchestrationEngine from "../orchestration/Services/OrchestrationEngine.ts";
import * as ProviderInstanceRegistryModule from "../provider/Services/ProviderInstanceRegistry.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import { OrchestrationEffectsService } from "./OrchestrationReactor.ts";
import { WorkSessionService } from "./WorkSessionService.ts";

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngine.OrchestrationEngineService;
  const workSessions = yield* WorkSessionService;
  const providerInstances = yield* ProviderInstanceRegistryModule.ProviderInstanceRegistry;
  const crypto = yield* Crypto.Crypto;
  // A UUID failure is a platform fault, not something a rule can act on; it
  // surfaces as the action failing, which the firing already records.
  const randomUUID = crypto.randomUUIDv4.pipe(Effect.orDie);
  // The same four services `ws.ts` hands the normalizer. Named explicitly
  // rather than inferred from the function's own type, which resolves to `any`
  // and quietly poisons the requirement channel of everything downstream.
  const normalizerContext = yield* Effect.context<
    FileSystem.FileSystem | Path.Path | ServerConfig.ServerConfig | WorkspacePaths.WorkspacePaths
  >();

  const serverCommandId = (tag: string) =>
    randomUUID.pipe(Effect.map((uuid) => CommandId.make(`rule:${tag}:${uuid}`)));

  const startProviderSession = (input: {
    readonly workSessionId: WorkSessionId;
    readonly action: Extract<OrchestrationAction, { kind: "start_provider_session" }>;
  }) =>
    Effect.gen(function* () {
      const workSession = yield* workSessions.get(input.workSessionId);

      // Refuse before creating anything. A rule that starts a thread on a
      // provider whose binary is missing produces a dead thread, a failed
      // session and a synopsis full of a spawn stack trace — all of which the
      // live proof produced before this check existed. The registry already
      // knows; asking it costs one lookup.
      const instance = yield* providerInstances.getInstance(input.action.providerInstanceId);
      if (instance === undefined || !instance.enabled) return null;
      const snapshot = yield* instance.snapshot.getSnapshot;
      if (!snapshot.installed || !isProviderAvailable(snapshot)) return null;

      const createdAt = yield* nowIso;
      const uuid = yield* randomUUID;
      const threadId = ThreadId.make(`rule-${input.workSessionId}-${uuid}`);

      const command = yield* normalizeDispatchCommand({
        type: "thread.create",
        commandId: yield* serverCommandId("start"),
        threadId,
        projectId: workSession.projectId,
        title: input.action.title,
        modelSelection: {
          instanceId: input.action.providerInstanceId,
          model: input.action.model,
        },
        runtimeMode: input.action.runtimeMode,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        // The same checkout the work is already in: a reviewer looking at a
        // different tree would be reviewing nothing.
        branch: workSession.baseBranch,
        worktreePath: workSession.primaryWorktreePath,
        createdAt,
      }).pipe(Effect.provideContext(normalizerContext));
      yield* engine.dispatch(command);

      yield* workSessions.attachThread({
        id: input.workSessionId,
        threadId,
        providerInstanceId: input.action.providerInstanceId,
        providerDriver: instance.driverKind,
        role: input.action.role,
        origin: "created",
        // A rule-started review must not steal the active slot from the work
        // the user is doing.
        makeActive: input.action.role === "implementation",
      });

      if (input.action.prompt.trim().length > 0) {
        const turn = yield* normalizeDispatchCommand({
          type: "thread.turn.start",
          commandId: yield* serverCommandId("turn"),
          threadId,
          message: {
            messageId: MessageId.make(`rule-msg-${uuid}`),
            role: "user",
            text: input.action.prompt,
            attachments: [],
          },
          runtimeMode: input.action.runtimeMode,
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          createdAt: yield* nowIso,
        }).pipe(Effect.provideContext(normalizerContext));
        yield* engine.dispatch(turn);
      }

      return threadId;
    }).pipe(Effect.catchCause(() => Effect.succeed(null)));

  const messageThread = (input: { readonly threadId: ThreadId; readonly text: string }) =>
    Effect.gen(function* () {
      const uuid = yield* randomUUID;
      const command = yield* normalizeDispatchCommand({
        type: "thread.turn.start",
        commandId: yield* serverCommandId("message"),
        threadId: input.threadId,
        message: {
          messageId: MessageId.make(`rule-msg-${uuid}`),
          role: "user",
          text: input.text,
          attachments: [],
        },
        runtimeMode: "approval-required",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        createdAt: yield* nowIso,
      }).pipe(Effect.provideContext(normalizerContext));
      yield* engine.dispatch(command);
      return true;
    }).pipe(Effect.catchCause(() => Effect.succeed(false)));

  /**
   * A notification is a synopsis entry today, not a push. The work session's
   * synopsis is what the fleet and the spoken status already read, so a rule's
   * message reaches every surface that answers "what needs me?" without a
   * second delivery mechanism to keep honest.
   */
  const notify = (input: { readonly workSessionId: WorkSessionId; readonly message: string }) =>
    Effect.gen(function* () {
      const at = yield* nowIso;
      yield* workSessions.applySynopsis({
        workSessionId: input.workSessionId,
        signals: [{ kind: "finding", at, text: input.message, source: "events" }],
      });
    }).pipe(Effect.ignoreCause({ log: true }));

  return { startProviderSession, messageThread, notify };
});

export const layer = Layer.effect(OrchestrationEffectsService, make);
