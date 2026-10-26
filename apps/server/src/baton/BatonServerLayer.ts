/* oxlint-disable t3code/no-low-value-comments -- Baton file predating upstream's rule (D82) */
/**
 * Everything Baton adds to the server, as two layers the server mounts at one point each
 * (`vendor-patches/t3code/0002-server-hooks.patch`):
 *
 * - `services`: work sessions, rules, intents, adopted sessions, the account pool, the engine
 *   seam and the one-shot model, with Baton's repositories on Baton's own database.
 * - `workers`: the reactors that follow upstream's events (synopsis, rules) and the account
 *   rotation tick, started the way upstream starts `PullRequestSyncReactor`.
 *
 * Later entries provide to earlier ones, so the order below is the dependency order.
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as AccountPoolService from "./AccountPoolService.ts";
import * as AccountRotationReactor from "./AccountRotationReactor.ts";
import * as AdoptedSessionService from "./AdoptedSessionService.ts";
import * as BatonDatabase from "./BatonDatabase.ts";
import * as BatonEngine from "./BatonEngine.ts";
import * as BatonOneShot from "./BatonOneShot.ts";
import * as BatonRpcHandlers from "./BatonRpcHandlers.ts";
import * as HerdrAdapter from "./HerdrAdapterLive.ts";
import * as IntentExecutor from "./IntentExecutorLive.ts";
import * as IntentService from "./IntentService.ts";
import * as OrchestrationEffects from "./OrchestrationEffectsLive.ts";
import * as OrchestrationReactor from "./OrchestrationReactor.ts";
import * as OrchestrationRuleService from "./OrchestrationRuleService.ts";
import * as SynopsisReactor from "./SynopsisReactor.ts";
import * as WorkSessionService from "./WorkSessionService.ts";

const servicesInner = IntentService.layer.pipe(
  // The intent surface consumes the reactor, the rule service and the same narrow effects a
  // rule uses, rather than reaching the engine on its own: one sentence and one rule cause work
  // through the same door.
  Layer.provideMerge(IntentExecutor.layer),
  Layer.provideMerge(SynopsisReactor.layer),
  Layer.provideMerge(OrchestrationReactor.layer),
  Layer.provideMerge(OrchestrationEffects.layer),
  Layer.provideMerge(OrchestrationRuleService.layer),
  Layer.provideMerge(
    Layer.mergeAll(
      // One work-session service for the whole server, so a mutation arriving on one client's
      // socket reaches every other client's subscription.
      WorkSessionService.layer,
      AccountPoolService.layer,
      // The adapter is provided here so the one place that talks to another program stays
      // visible, and a machine without Herdr still gets a service that refuses by name.
      AdoptedSessionService.layer.pipe(Layer.provide(HerdrAdapter.layer)),
      BatonEngine.layer,
      BatonOneShot.layer,
    ),
  ),
  // Baton's tables live in baton.sqlite; this client never reaches upstream's layers.
  Layer.provide(BatonDatabase.layer),
);

/** The services, plus `BatonRuntime` so the `fabric.*` routes find them (BatonRpcHandlers). */
export const services = BatonRpcHandlers.runtimeLayer.pipe(Layer.provideMerge(servicesInner));

export const workers = Layer.effectDiscard(
  Effect.gen(function* () {
    // The synopsis first: a rule that fires should see a synopsis the same events already moved.
    yield* (yield* SynopsisReactor.BatonSynopsisReactor).start();
    yield* (yield* OrchestrationReactor.BatonOrchestrationReactor).start();
  }),
).pipe(Layer.provideMerge(AccountRotationReactor.layer));
