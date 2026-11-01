/**
 * Notices, from the thread's own events, that a job's worker has finished its plan (D145), so the
 * job moves to "waiting for your OK" (or starts, with his standing permission) without anyone asking.
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { forkParked } from "../serverActivation.ts";
import { BatonEngine } from "./BatonEngine.ts";
import { noticePlan } from "./BatonJobFlow.ts";
import type { BatonJobService } from "./BatonJobService.ts";
import type { WorkSessionService } from "./WorkSessionService.ts";

export class BatonJobReactor extends Context.Service<
  BatonJobReactor,
  { readonly start: () => Effect.Effect<void, never, Scope.Scope> }
>()("t3/baton/BatonJobReactor") {}

export const layer = Layer.effect(
  BatonJobReactor,
  Effect.gen(function* () {
    const engine = yield* BatonEngine;
    const context = yield* Effect.context<BatonJobService | WorkSessionService | BatonEngine>();
    return {
      start: Effect.fn("BatonJobReactor.start")(function* () {
        yield* forkParked(
          Stream.runForEach(engine.changedThreads, (threadId) =>
            noticePlan(threadId).pipe(
              Effect.provideContext(context),
              Effect.ignoreCause({ log: true }),
            ),
          ),
        );
      }),
    };
  }),
);
