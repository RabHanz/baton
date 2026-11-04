import type { OrchestrationV2ProviderSession } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import type { ProviderSessionManagerV2Shape } from "./ProviderSessionManager.ts";

/** A session with no runtime and no activity this long reads as stopped. */
export const STOPPED_AFTER_MS = 10 * 60_000;

const WORKING = new Set<OrchestrationV2ProviderSession["status"]>([
  "starting",
  "ready",
  "running",
  "waiting",
]);

/**
 * A provider session whose process is gone must not read `ready`. The stored history stays as it is; clients get
 * `stopped` for a session that no runtime holds and that has been quiet for `STOPPED_AFTER_MS`.
 */
export const withStoppedSessions = Effect.fn("StoppedSessions.withStoppedSessions")(function* <
  T extends { readonly providerSessions: ReadonlyArray<OrchestrationV2ProviderSession> },
>(projection: T, manager: Pick<ProviderSessionManagerV2Shape, "isLive">, nowMs: number) {
  let changed = false;
  const providerSessions = yield* Effect.forEach(projection.providerSessions, (session) =>
    Effect.gen(function* () {
      if (
        !WORKING.has(session.status) ||
        nowMs - DateTime.toEpochMillis(session.updatedAt) < STOPPED_AFTER_MS ||
        (yield* manager.isLive(session.id))
      )
        return session;
      changed = true;
      return { ...session, status: "stopped" as const };
    }),
  );
  return changed ? { ...projection, providerSessions } : projection;
});
