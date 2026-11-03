/** The auto-resume watchdog's clock: once a minute, resume what died mid-turn (the rules are in AutoResume.ts). */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { BatonSessionCatalogService } from "./BatonSessionCatalogService.ts";

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const catalog = yield* BatonSessionCatalogService;
    yield* Effect.forkScoped(
      Effect.forever(
        Effect.sleep("60 seconds").pipe(
          Effect.andThen(catalog.watchdog({ action: "run" })),
          Effect.catchCause((cause) =>
            Effect.logWarning("Tessaya auto-resume watchdog failed", cause),
          ),
        ),
      ),
    );
  }),
);
