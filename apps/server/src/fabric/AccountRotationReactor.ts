/**
 * The trigger for automatic account rotation (D63, queue item 5).
 *
 * Rotation itself is `AccountPoolService.activate` (D56/D57). What was missing
 * is something that asks the question on its own: every tick this reads the
 * pool — the same limits T3 already reads for the composer — and lets the
 * tested policy (`decideRotation`) decide. One automatic rotation per limit
 * window, a cooldown, and hysteresis all live in that policy, not here.
 *
 * On by machine: `T3CODE_FABRIC_ON_LIMIT=auto`. Anything else is "ask", which
 * is the policy's own default, so a stock install never rotates by itself.
 *
 * shortcut: a poll, not a subscription to the limit event; the pool read is
 * the usage probe's own cache-backed call. Upgrade to the `limited` transition
 * when provider runtime events carry the limit.
 */
import { ProviderDriverKind } from "@t3tools/contracts";
import {
  activeAccount,
  decideRotation,
  type FabricOnLimitPolicy,
  type RotationDecision,
} from "@t3tools/shared/fabricAccountRotation";
import type { FabricAccountPool } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";

import { AccountPoolService } from "./AccountPoolService.ts";
import { readClaudeLiveSessions } from "./ClaudeLiveSessions.ts";
import { respawnClaudeInPane } from "./HerdrRespawn.ts";

export const FABRIC_ON_LIMIT_ENV = "T3CODE_FABRIC_ON_LIMIT";
const DRIVER = ProviderDriverKind.make("claudeAgent");
const TICK = "2 minutes";

/** The reset time of the active account's tightest window: the limit that is running out. */
export const sourceWindowResetsAt = (pool: FabricAccountPool): string | null => {
  const from = activeAccount(pool);
  if (from === null || from.windows.length === 0) return null;
  const tightest = from.windows.toSorted((a, b) => b.usedPercent - a.usedPercent)[0];
  return tightest?.resetsAt ?? null;
};

/** A spent window is a reported limit, which outranks any headroom estimate. */
export const limitReached = (pool: FabricAccountPool): boolean =>
  (activeAccount(pool)?.windows ?? []).some((window) => window.usedPercent >= 100);

/** One tick, pure: what the policy says given the pool and the last automatic rotation. */
export const rotationTick = (input: {
  readonly pool: FabricAccountPool;
  readonly policy: FabricOnLimitPolicy;
  readonly lastAutoRotationAt: string | null;
  readonly now: string;
}): RotationDecision =>
  decideRotation({
    pool: input.pool,
    policy: input.policy,
    lastAutoRotationAt: input.lastAutoRotationAt,
    sourceWindowResetsAt: sourceWindowResetsAt(input.pool),
    limitReached: limitReached(input.pool),
    now: input.now,
  });

export const make = Effect.gen(function* () {
  const policy: FabricOnLimitPolicy = process.env[FABRIC_ON_LIMIT_ENV] === "auto" ? "auto" : "ask";
  if (policy !== "auto") return;
  const pool = yield* AccountPoolService;
  let lastAutoRotationAt: string | null = null;

  const tick = Effect.gen(function* () {
    const current = yield* pool.read(DRIVER);
    const now = DateTime.formatIso(yield* DateTime.now);
    const decision = rotationTick({ pool: current, policy, lastAutoRotationAt, now });
    if (decision.outcome !== "rotate") return;
    yield* pool.activate({
      driver: DRIVER,
      key: decision.target.key,
      reason: decision.reason,
      workSessionId: null,
    });
    lastAutoRotationAt = now;
    // D67: sessions living in Herdr panes are restarted on the new account with
    // the same conversation. Busy ones are left alone: a session that is still
    // working has not hit the limit.
    const live = yield* readClaudeLiveSessions({ account: decision.target.label });
    for (const session of live) {
      if (session.herdrPane === null || session.status === "busy") continue;
      const result = yield* respawnClaudeInPane({
        paneRef: session.herdrPane,
        sessionId: session.sessionId,
      });
      yield* Effect.logInfo("Fabric respawned a Herdr Claude session", result);
    }
    yield* Effect.logInfo("Fabric rotated the Claude account on a limit", {
      from: decision.from?.label ?? null,
      to: decision.target.label,
      reason: decision.reason,
    });
  }).pipe(Effect.ignoreCause({ log: true }));

  yield* tick.pipe(Effect.repeat(Schedule.spaced(TICK)), Effect.forkScoped);
});

export const layer = Layer.effectDiscard(make);
