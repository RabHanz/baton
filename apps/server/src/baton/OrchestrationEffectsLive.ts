/* oxlint-disable t3code/no-low-value-comments, t3code/prefer-effect-fn -- Baton file predating upstream's rule (D82) */
// @effect-diagnostics effectFnOpportunity:off flatMapConditionalToFilterOrFail:off preferSchemaOverJson:off instanceOfSchema:off preferSucceedSomeOrNone:off
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
 * Every thread a rule creates goes through upstream's own launch service (via
 * `BatonEngine`), the path a client's new thread takes, and is attached to the work session with `origin: created`, so the timeline
 * shows that a rule made it rather than a person.
 */
import {
  isProviderAvailable,
  type OrchestrationAction,
  type ThreadId,
  type WorkSessionId,
} from "@t3tools/baton-contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ProviderInstanceRegistryModule from "../provider/ProviderInstanceRegistry.ts";
import { BatonEngine } from "./BatonEngine.ts";
import { OrchestrationEffectsService } from "./OrchestrationReactor.ts";
import { WorkSessionService } from "./WorkSessionService.ts";

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const engine = yield* BatonEngine;
  const workSessions = yield* WorkSessionService;
  const providerInstances = yield* ProviderInstanceRegistryModule.ProviderInstanceRegistry;

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

      const threadId = yield* engine.launchThread({
        tag: `rule:${input.workSessionId}`,
        projectId: workSession.projectId,
        title: input.action.title,
        modelSelection: { instanceId: input.action.providerInstanceId, model: input.action.model },
        runtimeMode: input.action.runtimeMode,
        worktreePath: workSession.primaryWorktreePath,
        branch: workSession.baseBranch,
        text: input.action.prompt,
      });
      if (threadId === null) return null;

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
      return threadId;
    }).pipe(Effect.catchCause(() => Effect.succeed(null)));

  const messageThread = (input: { readonly threadId: ThreadId; readonly text: string }) =>
    engine.sendMessage({ tag: "rule", threadId: input.threadId, text: input.text });

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
