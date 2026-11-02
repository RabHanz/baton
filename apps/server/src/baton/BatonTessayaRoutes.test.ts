import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter } from "effect/http";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import { BatonRuntime } from "./BatonRpcHandlers.ts";
import { routes } from "./BatonTessayaRoutes.ts";

const platformLayer = NodeHttpPlatform.layer.pipe(Layer.provideMerge(NodeServices.layer));

// The real router with the real routes: a path registered twice (a trailing-slash twin, say) throws when it is built, which
// is how the server crashed at start after the router changed under it.
const serve = (path: string) =>
  Effect.gen(function* () {
    const handler = yield* Effect.acquireRelease(
      Effect.sync(() =>
        HttpRouter.toWebHandler(
          routes.pipe(
            Layer.provide(Layer.succeed(BatonRuntime, Context.empty())),
            Layer.provide(
              Layer.succeed(ServerConfig.ServerConfig, {
                dbPath: "/nowhere/state.sqlite",
              } as never),
            ),
            Layer.provide(platformLayer),
            Layer.provideMerge(
              Layer.mock(EnvironmentAuth.EnvironmentAuth, {
                authenticateHttpRequest: () => Effect.fail(new Error("no session") as never),
              }),
            ),
          ),
          { disableLogger: true },
        ),
      ),
      ({ dispose }) => Effect.promise(dispose),
    );
    return yield* Effect.promise(() => handler.handler(new Request(`http://t3.test${path}`)));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

it.effect("registers the phone routes without a duplicate and serves each of them", () =>
  Effect.gen(function* () {
    for (const [path, type] of [
      ["/tessaya", "text/html"],
      ["/tessaya/", "text/html"],
      ["/tessaya/app.js", "text/javascript"],
      ["/tessaya/sw.js", "text/javascript"],
      ["/tessaya/manifest.webmanifest", "application/manifest+json"],
    ] as const) {
      const response = yield* serve(path);
      expect(response.status, path).toBe(200);
      expect(response.headers.get("content-type"), path).toContain(type);
    }
  }),
);

it.effect("keeps the API behind a session", () =>
  Effect.gen(function* () {
    expect((yield* serve("/tessaya/api/state")).status).toBe(401);
  }),
);
