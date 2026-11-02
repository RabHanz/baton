// @effect-diagnostics globalDate:off
/** The session catalog as a service, so the RPC door, agents and MCP all reach the same methods. */
import type {
  BatonCatalogSession,
  BatonCatalogState,
} from "@t3tools/baton-contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { AdoptedSessionService } from "./AdoptedSessionService.ts";
import { herdrSend } from "./HerdrSend.ts";
import { createSessionCatalog } from "./SessionCatalog.ts";
import { realCatalogPorts } from "./SessionCatalogLive.ts";

export class BatonSessionCatalogService extends Context.Service<
  BatonSessionCatalogService,
  {
    readonly list: (input: { query?: string; limit?: number; before?: string }) => Effect.Effect<{
      readonly machine: string;
      readonly sessions: ReadonlyArray<BatonCatalogSession>;
      readonly more: boolean;
    }>;
    readonly folders: (input: { query?: string }) => Effect.Effect<{
      readonly folders: ReadonlyArray<{ cwd: string; project: string; lastActivityAt: string | null }>;
    }>;
    readonly resume: (input: { sessionId: string; cwd?: string }) => Effect.Effect<{
      readonly state: BatonCatalogState;
      readonly pane: string | null;
      readonly detail: string | null;
    }>;
    readonly create: (input: { cwd: string }) => Effect.Effect<{
      readonly state: BatonCatalogState;
      readonly sessionId: string | null;
      readonly pane: string | null;
      readonly detail: string | null;
    }>;
    readonly send: (input: { sessionId: string; text: string; cwd?: string }) => Effect.Effect<{
      readonly state: BatonCatalogState;
      readonly delivered: boolean;
      readonly detail: string | null;
    }>;
  }
>()("t3/baton/BatonSessionCatalogService") {}

export const layer = Layer.effect(
  BatonSessionCatalogService,
  Effect.gen(function* () {
    const adopted = yield* AdoptedSessionService;
    const services = yield* Effect.context<never>();
    const catalog = createSessionCatalog(
      realCatalogPorts((pane, text) =>
        Effect.runPromiseWith(services)(herdrSend(adopted, { pane, text, submit: true })).then((r) => r.delivered),
      ),
    );
    return BatonSessionCatalogService.of({
      list: Effect.fn("BatonSessionCatalogService.list")(function* (input: { query?: string; limit?: number; before?: string }) {
        return yield* Effect.promise(() => catalog.list(input));
      }),
      folders: Effect.fn("BatonSessionCatalogService.folders")(function* (input: { query?: string }) {
        return yield* Effect.promise(() => catalog.folders(input));
      }),
      resume: Effect.fn("BatonSessionCatalogService.resume")(function* (input: { sessionId: string; cwd?: string }) {
        return yield* Effect.promise(() => catalog.resume(input));
      }),
      create: Effect.fn("BatonSessionCatalogService.create")(function* (input: { cwd: string }) {
        return yield* Effect.promise(() => catalog.create(input));
      }),
      send: Effect.fn("BatonSessionCatalogService.send")(function* (input: { sessionId: string; text: string; cwd?: string }) {
        return yield* Effect.promise(() => catalog.send(input));
      }),
    });
  }),
);
