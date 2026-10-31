/* oxlint-disable t3code/no-low-value-comments -- Baton file predating upstream's rule (D82) */
/**
 * Handlers for `BatonRpcGroup` (the `fabric.*` methods). Mounted in `ws.ts` beside upstream's
 * handlers by `vendor-patches/t3code/0002-server-hooks.patch`; the domain lives in the services,
 * and this file only routes. Everything that touches upstream's engine goes through `BatonEngine`.
 *
 * The services arrive through `BatonRuntime`, a reference with a null default, so building the
 * routes needs nothing Baton-specific: upstream's own ws tests compile and run unchanged, and a
 * server without Baton's layer answers `fabric.*` with a defect naming why.
 */
import {
  BATON_ACCOUNT_WS_METHODS,
  BATON_ADOPTED_WS_METHODS,
  BATON_HANDOFF_WS_METHODS,
  BATON_INTENT_WS_METHODS,
  BATON_LIVE_WS_METHODS,
  BATON_ORCHESTRATION_WS_METHODS,
  BATON_WS_METHODS,
  BatonRpcGroup,
  isProviderAvailable,
  accountRefusal,
  BATON_CLAUDE_ACCOUNT_INSTANCES,
  BATON_DEFAULT_CLAUDE_INSTANCE,
  BatonAccountRotationFailedError,
  BatonAccountRotationRefusedError,
  instanceForAccount,
  type BatonThreadAccountUseInput,
  OrchestrationFiringNotFoundError,
  ProviderDriverKind,
  WorkSessionHandoffRefusedError,
  type WorkSessionHandoffInput,
} from "@t3tools/baton-contracts";
import { ProviderInstanceId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import { AccountPoolService } from "./AccountPoolService.ts";
import { AdoptedSessionService } from "./AdoptedSessionService.ts";
import { BatonEngine } from "./BatonEngine.ts";
import * as FleetQuery from "./FleetQuery.ts";
import { herdrSend } from "./HerdrSend.ts";
import { BatonIntentService } from "./IntentService.ts";
import { liveAdopt, liveAttach } from "./LiveActions.ts";
import { BatonOrchestrationReactor } from "./OrchestrationReactor.ts";
import { OrchestrationRuleService } from "./OrchestrationRuleService.ts";
import { ThreadAccountMoves } from "./ThreadAccountMoves.ts";
import { WorkSessionService, workSessionStream } from "./WorkSessionService.ts";

/** Only Claude keeps several accounts behind one config directory today. */
const DEFAULT_ROTATION_DRIVER = ProviderDriverKind.make("claudeAgent");

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

export type BatonServices =
  | WorkSessionService
  | AccountPoolService
  | OrchestrationRuleService
  | BatonOrchestrationReactor
  | BatonIntentService
  | AdoptedSessionService
  | BatonEngine
  | ThreadAccountMoves
  | ProviderInstanceRegistry.ProviderInstanceRegistry
  | ProviderRegistry.ProviderRegistry;

/** Baton's services, or null on a server built without `BatonServerLayer.services`. */
export const BatonRuntime = Context.Reference<Context.Context<BatonServices> | null>(
  "t3/baton/BatonRpcHandlers/BatonRuntime",
  { defaultValue: () => null },
);

/** Captures Baton's services for the routes; part of `BatonServerLayer.services`. */
export const runtimeLayer = Layer.effect(BatonRuntime, Effect.context<BatonServices>());

const unavailable = () => new Error("Baton's services are not running on this server.");

/** One thread's account (D95): refused here, so no client's menu is the only check. */
const threadAccountUse = Effect.fn("fabric.account.useForThread")(function* (
  input: BatonThreadAccountUseInput,
) {
  const key = input.key ?? "active";
  const refuse = (reason: "unknown-account" | "unusable", detail: string | null) =>
    new BatonAccountRotationRefusedError({ key, reason, detail });
  const providerInstances = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const pool = yield* Effect.flatMap(AccountPoolService, (service) =>
    service.read(DEFAULT_ROTATION_DRIVER),
  );
  const account = pool.accounts.find((entry) =>
    input.key === null ? entry.active : entry.key === input.key,
  );
  if (account === undefined) return yield* refuse("unknown-account", null);
  const refusal = accountRefusal(account);
  if (refusal !== null) return yield* refuse("unusable", refusal);
  const pinned = Object.keys(BATON_CLAUDE_ACCOUNT_INSTANCES);
  const available = new Set<string>();
  for (const instanceId of pinned) {
    const instance = yield* providerInstances.getInstance(ProviderInstanceId.make(instanceId));
    if (instance?.enabled === true) available.add(instanceId);
  }
  const instanceId =
    input.key === null
      ? BATON_DEFAULT_CLAUDE_INSTANCE
      : instanceForAccount(account, (id) => available.has(id));
  if (instanceId === null) {
    return yield* refuse("unusable", `${account.label} has no provider instance on this machine`);
  }
  return yield* Effect.flatMap(ThreadAccountMoves, (moves) =>
    moves.request({ threadId: input.threadId, instanceId }),
  ).pipe(
    Effect.mapError((error) => new BatonAccountRotationFailedError({ key, detail: error.message })),
  );
});

/** §6.1 through upstream's provider.switch (D80): same thread, upstream's context handoff. */
const handoff = Effect.fn("fabric.workSession.handoff")(function* (input: WorkSessionHandoffInput) {
  const workSessions = yield* WorkSessionService;
  const engine = yield* BatonEngine;
  const providerInstances = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const workSession = yield* workSessions.get(input.id);
  const refuse = (reason: string) =>
    new WorkSessionHandoffRefusedError({ workSessionId: input.id, reason });
  const threadId = workSession.activeThreadId;
  if (threadId === null) return yield* refuse("no session is running on this work.");
  const from = workSession.providerSessions.find(
    (session) => session.threadId === threadId && session.detachedAt === null,
  );
  const targetId = input.modelSelection.instanceId;
  if (from?.providerInstanceId === targetId) {
    return yield* refuse(
      "the target is the instance already running it; rotate the account in place instead (fabric.account.use).",
    );
  }
  const instance = yield* providerInstances.getInstance(targetId);
  if (instance === undefined || !instance.enabled) {
    return yield* refuse(`provider instance ${targetId} is not configured here.`);
  }
  const snapshot = yield* instance.snapshot.getSnapshot;
  if (!snapshot.installed || !isProviderAvailable(snapshot)) {
    return yield* refuse(`provider instance ${targetId} is not signed in or available.`);
  }
  yield* engine
    .switchProvider({ tag: "handoff", threadId, modelSelection: input.modelSelection })
    .pipe(Effect.mapError((error) => refuse(error.detail)));
  if (input.note !== undefined && input.note.trim().length > 0) {
    yield* engine.sendMessage({ tag: "handoff", threadId, text: input.note });
  }
  yield* workSessions
    .applySynopsis({
      workSessionId: input.id,
      signals: [
        {
          kind: "finding",
          at: yield* nowIso,
          text: `Moved from ${from?.providerInstanceId ?? "no active provider"} to ${instance.driverKind} / ${targetId}.`,
          source: "events",
        },
      ],
    })
    .pipe(Effect.ignoreCause({ log: true }));
  return { workSession: yield* workSessions.get(input.id) };
});

export const make = Effect.gen(function* () {
  const context = yield* BatonRuntime;
  const run = <A, E>(effect: Effect.Effect<A, E, BatonServices>): Effect.Effect<A, E> =>
    context === null ? Effect.die(unavailable()) : Effect.provideContext(effect, context);

  return yield* BatonRpcGroup.toHandlers({
    [BATON_ACCOUNT_WS_METHODS.accountPool]: (input) =>
      run(
        Effect.flatMap(AccountPoolService, (pool) =>
          pool.read(input.driver ?? DEFAULT_ROTATION_DRIVER),
        ),
      ),
    [BATON_ACCOUNT_WS_METHODS.accountUse]: (input) =>
      run(
        Effect.flatMap(AccountPoolService, (pool) =>
          pool.activate({
            driver: input.driver ?? DEFAULT_ROTATION_DRIVER,
            key: input.key,
            reason: input.reason ?? "manual",
            workSessionId: input.workSessionId ?? null,
          }),
        ).pipe(
          // The default instance's name and limits follow the switch now, not at the next 5-minute check.
          Effect.tap(() =>
            Effect.flatMap(ProviderRegistry.ProviderRegistry, (registry) =>
              Effect.forkDetach(registry.refresh(input.driver ?? DEFAULT_ROTATION_DRIVER)),
            ),
          ),
        ),
      ),
    [BATON_ACCOUNT_WS_METHODS.threadAccountUse]: (input) => run(threadAccountUse(input)),
    [BATON_WS_METHODS.workSessionList]: (input) =>
      run(
        Effect.flatMap(WorkSessionService, (ws) =>
          Effect.map(ws.list(input), (sessions) => ({ workSessions: sessions })),
        ),
      ),
    [BATON_WS_METHODS.workSessionCreate]: (input) =>
      run(
        Effect.flatMap(WorkSessionService, (ws) =>
          Effect.map(ws.create(input), (workSession) => ({ workSession })),
        ),
      ),
    [BATON_WS_METHODS.workSessionUpdate]: (input) =>
      run(
        Effect.flatMap(WorkSessionService, (ws) =>
          Effect.map(ws.update(input), (workSession) => ({ workSession })),
        ),
      ),
    [BATON_WS_METHODS.workSessionAttachThread]: (input) =>
      run(
        Effect.flatMap(WorkSessionService, (ws) =>
          Effect.map(ws.attachThread(input), (workSession) => ({ workSession })),
        ),
      ),
    [BATON_WS_METHODS.workSessionDetachThread]: (input) =>
      run(
        Effect.flatMap(WorkSessionService, (ws) =>
          Effect.map(ws.detachThread(input), (workSession) => ({ workSession })),
        ),
      ),
    [BATON_WS_METHODS.workSessionStartThread]: (input) =>
      run(
        Effect.gen(function* () {
          const workSessions = yield* WorkSessionService;
          const engine = yield* BatonEngine;
          const providerInstances = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
          const workSession = yield* workSessions.get(input.id);
          // Upstream's launch path, so worktree bootstrap, checkpoints and analytics behave as
          // for a thread started from the sidebar. Defaulting to the work session's own checkout
          // keeps sequential providers on the same branch.
          yield* engine.launchThread({
            tag: "work-session",
            threadId: input.threadId,
            projectId: workSession.projectId,
            title: input.title,
            modelSelection: input.modelSelection,
            runtimeMode: input.runtimeMode,
            interactionMode: input.interactionMode,
            worktreePath: input.worktreePath ?? workSession.primaryWorktreePath,
            branch: input.branch ?? workSession.baseBranch,
            text: "",
          });
          const instance = yield* providerInstances.getInstance(input.modelSelection.instanceId);
          const attached = yield* workSessions.attachThread({
            id: input.id,
            threadId: input.threadId,
            providerInstanceId: input.modelSelection.instanceId,
            providerDriver: instance?.driverKind ?? null,
            origin: "created",
            ...(input.role === undefined ? {} : { role: input.role }),
          });
          return { workSession: attached };
        }),
      ),
    [BATON_HANDOFF_WS_METHODS.workSessionHandoff]: (input) => run(handoff(input)),
    [BATON_LIVE_WS_METHODS.liveAttach]: (input) =>
      run(Effect.flatMap(AdoptedSessionService, (adopted) => liveAttach(adopted, input))),
    [BATON_LIVE_WS_METHODS.liveAdopt]: (input) => liveAdopt(input),
    [BATON_LIVE_WS_METHODS.herdrSend]: (input) =>
      run(Effect.flatMap(AdoptedSessionService, (adopted) => herdrSend(adopted, input))),
    // Settling a work session settles its threads in upstream too, so T3's own sidebar agrees.
    [BATON_WS_METHODS.workSessionSettle]: (input) =>
      run(
        Effect.gen(function* () {
          const engine = yield* BatonEngine;
          const workSession = yield* (yield* WorkSessionService).settle(input);
          for (const session of workSession.providerSessions) {
            if (session.detachedAt === null) {
              yield* engine.settleThread({ tag: "work-session", threadId: session.threadId });
            }
          }
          return { workSession };
        }),
      ),
    [BATON_WS_METHODS.workSessionUnsettle]: (input) =>
      run(
        Effect.flatMap(WorkSessionService, (ws) =>
          Effect.map(ws.unsettle(input), (workSession) => ({ workSession })),
        ),
      ),
    [BATON_WS_METHODS.workSessionArchive]: (input) =>
      run(
        Effect.flatMap(WorkSessionService, (ws) =>
          Effect.map(ws.archive(input), (workSession) => ({ workSession })),
        ),
      ),
    [BATON_WS_METHODS.workSessionUnarchive]: (input) =>
      run(
        Effect.flatMap(WorkSessionService, (ws) =>
          Effect.map(ws.unarchive(input), (workSession) => ({ workSession })),
        ),
      ),
    [BATON_WS_METHODS.fleetGet]: (input) =>
      run(Effect.map(FleetQuery.getFleet(input), (fleet) => ({ fleet }))),
    [BATON_ORCHESTRATION_WS_METHODS.ruleCreate]: (input) =>
      run(
        Effect.flatMap(OrchestrationRuleService, (rules) =>
          Effect.map(rules.create(input), (rule) => ({ rule })),
        ),
      ),
    [BATON_ORCHESTRATION_WS_METHODS.ruleList]: (input) =>
      run(
        Effect.flatMap(OrchestrationRuleService, (rules) =>
          Effect.map(rules.list(input), (listed) => ({ rules: listed })),
        ),
      ),
    [BATON_ORCHESTRATION_WS_METHODS.ruleDisable]: (input) =>
      run(
        Effect.flatMap(OrchestrationRuleService, (rules) =>
          Effect.map(rules.setStatus({ id: input.id, status: "disabled" }), (rule) => ({ rule })),
        ),
      ),
    [BATON_ORCHESTRATION_WS_METHODS.ruleEnable]: (input) =>
      run(
        Effect.flatMap(OrchestrationRuleService, (rules) =>
          Effect.map(rules.setStatus({ id: input.id, status: "enabled" }), (rule) => ({ rule })),
        ),
      ),
    [BATON_ORCHESTRATION_WS_METHODS.ruleConfirm]: (input) =>
      run(
        Effect.gen(function* () {
          const rules = yield* OrchestrationRuleService;
          const firing = yield* rules.getFiring(input.firingId);
          if (firing === null) {
            return yield* new OrchestrationFiringNotFoundError({ firingId: input.firingId });
          }
          // Answering the gate settles that firing either way; a refusal is a completed
          // decision, and rules sequenced behind it stay parked because only `completed`
          // releases them.
          yield* rules.completeFiring({
            firingId: input.firingId,
            outcome: input.confirmed ? "completed" : "skipped",
            producedThreadId: null,
            detail: input.confirmed ? "Confirmed." : "Declined.",
          });
          if (input.confirmed) {
            yield* (yield* BatonOrchestrationReactor)
              .evaluate({
                workSessionId: firing.workSessionId,
                changedThreadId: null,
                // Not the rule that asked: re-firing it would re-ask in the same second (D29).
                skipRuleId: firing.ruleId,
              })
              .pipe(Effect.ignoreCause({ log: true }));
          }
          const listed = yield* rules.list({
            workSessionId: firing.workSessionId,
            includeDisabled: true,
          });
          return { rules: listed };
        }),
      ),
    [BATON_INTENT_WS_METHODS.intentResolve]: (input) =>
      run(
        Effect.flatMap(BatonIntentService, (intents) =>
          Effect.map(
            intents.resolve({
              text: input.text,
              focusedWorkSessionId: input.focusedWorkSessionId ?? null,
              // Absent means no: a preview that fires on every pause in typing must not spend a
              // model call each time (D50).
              allowModel: input.allowModel ?? false,
            }),
            (resolution) => ({ resolution }),
          ),
        ),
      ),
    [BATON_INTENT_WS_METHODS.intentRun]: (input) =>
      run(
        Effect.flatMap(BatonIntentService, (intents) =>
          intents.run({
            text: input.text,
            focusedWorkSessionId: input.focusedWorkSessionId ?? null,
          }),
        ),
      ),
    [BATON_INTENT_WS_METHODS.intentList]: (input) =>
      run(
        Effect.flatMap(BatonIntentService, (intents) =>
          Effect.map(
            intents.list({
              workSessionId: input.workSessionId ?? null,
              limit: input.limit ?? null,
            }),
            (recorded) => ({ intents: recorded }),
          ),
        ),
      ),
    [BATON_ADOPTED_WS_METHODS.adoptedDiscover]: () =>
      run(Effect.flatMap(AdoptedSessionService, (adopted) => adopted.discover)),
    [BATON_ADOPTED_WS_METHODS.adoptedRegister]: (input) =>
      run(
        Effect.flatMap(AdoptedSessionService, (adopted) =>
          Effect.map(adopted.register(input), (session) => ({ session })),
        ),
      ),
    [BATON_ADOPTED_WS_METHODS.adoptedList]: (input) =>
      run(
        Effect.flatMap(AdoptedSessionService, (adopted) =>
          Effect.map(adopted.list(input), (sessions) => ({ sessions })),
        ),
      ),
    [BATON_ADOPTED_WS_METHODS.adoptedRefresh]: (input) =>
      run(
        Effect.flatMap(AdoptedSessionService, (adopted) =>
          Effect.map(adopted.refresh(input), (session) => ({ session })),
        ),
      ),
    [BATON_ADOPTED_WS_METHODS.adoptedDetach]: (input) =>
      run(
        Effect.flatMap(AdoptedSessionService, (adopted) =>
          Effect.map(adopted.detach(input.id), (session) => ({ session })),
        ),
      ),
    [BATON_ADOPTED_WS_METHODS.adoptedSendInput]: (input) =>
      run(Effect.flatMap(AdoptedSessionService, (adopted) => adopted.sendInput(input))),
    [BATON_ADOPTED_WS_METHODS.adoptedReadOutput]: (input) =>
      run(Effect.flatMap(AdoptedSessionService, (adopted) => adopted.readOutput(input))),
    [BATON_WS_METHODS.subscribeWorkSessions]: () =>
      context === null
        ? Stream.die(unavailable())
        : workSessionStream(Context.get(context, WorkSessionService)),
  });
});
