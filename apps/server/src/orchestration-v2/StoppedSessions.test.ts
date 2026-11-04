import { it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import type { OrchestrationV2ProviderSession } from "@t3tools/contracts";
import { expect } from "vite-plus/test";

import { STOPPED_AFTER_MS, withStoppedSessions } from "./StoppedSessions.ts";

const NOW = Date.UTC(2026, 10, 4, 12);
const session = (id: string, status: string, agoMs: number) =>
  ({
    id,
    status,
    updatedAt: DateTime.makeUnsafe(NOW - agoMs),
  }) as unknown as OrchestrationV2ProviderSession;

it.effect(
  "a quiet session no runtime holds reads stopped; live, recent and finished ones do not",
  () =>
    Effect.gen(function* () {
      const manager = { isLive: (id: string) => Effect.succeed(id === "live") } as never;
      const old = STOPPED_AFTER_MS + 1;
      const projection = {
        providerSessions: [
          session("gone", "ready", old),
          session("live", "ready", old),
          session("recent", "ready", 1_000),
          session("errored", "error", old),
          session("waiting", "waiting", old),
        ],
      };
      const shown = yield* withStoppedSessions(projection, manager, NOW);
      expect(shown.providerSessions.map((s) => [s.id, s.status])).toEqual([
        ["gone", "stopped"],
        ["live", "ready"],
        ["recent", "ready"],
        ["errored", "error"],
        ["waiting", "stopped"],
      ]);
      // The stored projection is not touched.
      expect(projection.providerSessions[0]!.status).toBe("ready");
    }),
);
