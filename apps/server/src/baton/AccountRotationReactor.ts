/* oxlint-disable t3code/no-low-value-comments -- Baton file predating upstream's rule (D82) */
/**
 * The trigger for automatic account rotation (D63, L-76).
 *
 * T3 threads: an account is a provider instance, and its limits are the ones the provider reports in
 * the instance's snapshot. Every tick, each instance with working threads is weighed against the
 * instances that share its transcripts (the same continuation group), and when the tested policy
 * (`decideRotation`) says rotate, those threads move through ThreadAccountMoves: at once when idle,
 * at the end of the turn when one is running. Idle threads stay where he put them.
 *
 * Terminal sessions (Herdr) still run on cswap's machine login, so that login rotates as before and
 * idle panes are respawned on it. On by the Settings row (AccountRotationPolicy).
 *
 * shortcut: a poll, not a subscription to the limit event. Upgrade when provider runtime events
 * carry the limit to a reactor.
 */
import { ProviderDriverKind } from "@t3tools/baton-contracts";
import {
  activeAccount,
  decideRotation,
  type BatonOnLimitPolicy,
  type RotationDecision,
} from "@t3tools/baton-shared/accountRotation";
import type { BatonAccount, BatonAccountPool } from "@t3tools/baton-contracts";
import {
  isLiveSubagentShell,
  type OrchestrationV2ThreadShell,
  type ServerProvider,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";

import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import { AccountPoolService, headroomFromWindows } from "./AccountPoolService.ts";
import { AccountRotationPolicy } from "./AccountRotationPolicy.ts";
import { BatonEngine } from "./BatonEngine.ts";
import { readClaudeLiveSessions } from "./ClaudeLiveSessions.ts";
import { respawnClaudeInPane } from "./HerdrRespawn.ts";
import { ThreadAccountMoves } from "./ThreadAccountMoves.ts";

const DRIVER = ProviderDriverKind.make("claudeAgent");
const TICK = "2 minutes";

/** The reset time of the active account's tightest window: the limit that is running out. */
export const sourceWindowResetsAt = (pool: BatonAccountPool): string | null => {
  const from = activeAccount(pool);
  if (from === null || from.windows.length === 0) return null;
  const tightest = from.windows.toSorted((a, b) => b.usedPercent - a.usedPercent)[0];
  return tightest?.resetsAt ?? null;
};

/** A spent window is a reported limit, which outranks any headroom estimate. */
export const limitReached = (pool: BatonAccountPool): boolean =>
  (activeAccount(pool)?.windows ?? []).some((window) => window.usedPercent >= 100);

/** One tick, pure: what the policy says given the pool and the last automatic rotation. */
export const rotationTick = (input: {
  readonly pool: BatonAccountPool;
  readonly policy: BatonOnLimitPolicy;
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

/** One Claude instance as an account: its own reported windows, its key the instance id. */
export const instanceAccount = (provider: ServerProvider, active: boolean): BatonAccount => {
  const windows = (provider.usageLimits?.windows ?? []).map((window) => ({
    id: window.id,
    label: window.label,
    usedPercent: window.usedPercent,
    resetsAt: window.resetsAt ?? null,
  }));
  const headroom = headroomFromWindows(windows);
  const signedOut = provider.auth.status === "unauthenticated";
  return {
    key: provider.instanceId,
    label: provider.displayName ?? provider.instanceId,
    email: provider.auth.email ?? null,
    organizationName: null,
    active,
    usable: !signedOut && headroom !== null,
    unusableReason: signedOut ? "signed-out" : headroom === null ? "limits-unknown" : null,
    headroomPercent: headroom,
    windows,
    usageCheckedAt: provider.usageLimits?.checkedAt ?? null,
  } as BatonAccount;
};

/** The accounts a thread on `instanceId` can resume on: Claude instances sharing its transcripts. */
export const instancePool = (
  providers: ReadonlyArray<ServerProvider>,
  instanceId: string,
  now: string,
): BatonAccountPool | null => {
  const source = providers.find((provider) => provider.instanceId === instanceId);
  if (source === undefined || source.driver !== DRIVER) return null;
  const group = source.continuation?.groupKey;
  const peers = providers.filter(
    (provider) =>
      provider.instanceId === instanceId ||
      (provider.driver === DRIVER &&
        provider.enabled &&
        provider.installed &&
        group !== undefined &&
        provider.continuation?.groupKey === group),
  );
  return {
    driver: DRIVER,
    source: "instances",
    configDir: group ?? instanceId,
    accounts: peers.map((provider) =>
      instanceAccount(provider, provider.instanceId === instanceId),
    ),
    checkedAt: now,
  } as BatonAccountPool;
};

/** A thread doing work now, or stopped by a limit; an idle thread keeps the account he chose. */
export const threadIsWorking = (shell: OrchestrationV2ThreadShell): boolean =>
  shell.archivedAt === null &&
  shell.deletedAt === null &&
  (isLiveSubagentShell(shell) || (shell.limitRecovery ?? null) !== null);

export interface ThreadMovePlan {
  readonly from: BatonAccount | null;
  readonly target: BatonAccount;
  readonly reason: "limit" | "policy";
  readonly threadIds: ReadonlyArray<OrchestrationV2ThreadShell["id"]>;
}

/** Pure: which working threads move where, one decision per instance they run on. */
export const planThreadMoves = (input: {
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly shells: ReadonlyArray<OrchestrationV2ThreadShell>;
  readonly lastAutoRotationAt: ReadonlyMap<string, string>;
  readonly now: string;
}): ReadonlyArray<ThreadMovePlan> => {
  const working = new Map<string, Array<OrchestrationV2ThreadShell["id"]>>();
  for (const shell of input.shells) {
    if (!threadIsWorking(shell)) continue;
    const ids = working.get(shell.providerInstanceId) ?? [];
    ids.push(shell.id);
    working.set(shell.providerInstanceId, ids);
  }
  return [...working].flatMap(([instanceId, threadIds]) => {
    const pool = instancePool(input.providers, instanceId, input.now);
    if (pool === null) return [];
    const decision = rotationTick({
      pool,
      policy: "auto",
      lastAutoRotationAt: input.lastAutoRotationAt.get(instanceId) ?? null,
      now: input.now,
    });
    return decision.outcome === "rotate"
      ? [{ from: decision.from, target: decision.target, reason: decision.reason, threadIds }]
      : [];
  });
};

export const make = Effect.gen(function* () {
  const policy = yield* AccountRotationPolicy;
  const pool = yield* AccountPoolService;
  const registry = yield* ProviderRegistry.ProviderRegistry;
  const engine = yield* BatonEngine;
  const moves = yield* ThreadAccountMoves;
  const threadRotatedAt = new Map<string, string>();
  let lastAutoRotationAt: string | null = null;

  const moveThreads = Effect.fn("AccountRotationReactor.moveThreads")(function* (now: string) {
    const plans = planThreadMoves({
      providers: yield* registry.getProviders,
      shells: yield* engine.threadShells,
      lastAutoRotationAt: threadRotatedAt,
      now,
    });
    for (const plan of plans) {
      if (plan.from !== null) threadRotatedAt.set(plan.from.key, now);
      for (const threadId of plan.threadIds) {
        yield* moves
          .request({ threadId, instanceId: plan.target.key })
          .pipe(Effect.ignoreCause({ log: true }));
      }
      yield* Effect.logInfo("Tessaya moved threads to another account on a limit", {
        from: plan.from?.label ?? null,
        to: plan.target.label,
        reason: plan.reason,
        threads: plan.threadIds.length,
      });
    }
  });

  // The machine login his terminal sessions run on (cswap).
  const rotateTerminalLogin = Effect.fn("AccountRotationReactor.rotateTerminalLogin")(function* (
    now: string,
  ) {
    // A machine without cswap has no terminal login to rotate, which is not worth a log line.
    const current = yield* pool.read(DRIVER).pipe(Effect.option);
    if (current._tag === "None") return;
    const decision = rotationTick({
      pool: current.value,
      policy: "auto",
      lastAutoRotationAt,
      now,
    });
    if (decision.outcome !== "rotate") return;
    yield* pool.activate({
      driver: DRIVER,
      key: decision.target.key,
      reason: decision.reason,
      workSessionId: null,
    });
    lastAutoRotationAt = now;
    // D69: sessions living in Herdr panes are restarted on the new account with
    // the same conversation. Busy ones are left alone: a session that is still
    // working has not hit the limit.
    const live = yield* readClaudeLiveSessions({ account: decision.target.label });
    for (const session of live) {
      if (session.herdrPane === null || session.status === "busy") continue;
      const result = yield* respawnClaudeInPane({
        paneRef: session.herdrPane,
        sessionId: session.sessionId,
      });
      yield* Effect.logInfo("Tessaya respawned a Herdr Claude session", result);
    }
    yield* Effect.logInfo("Tessaya rotated the terminal sessions' Claude account on a limit", {
      from: decision.from?.label ?? null,
      to: decision.target.label,
      reason: decision.reason,
    });
  });

  const tick = Effect.gen(function* () {
    if ((yield* policy.read) !== "auto") return;
    const now = DateTime.formatIso(yield* DateTime.now);
    yield* moveThreads(now).pipe(Effect.ignoreCause({ log: true }));
    yield* rotateTerminalLogin(now).pipe(Effect.ignoreCause({ log: true }));
  });

  yield* tick.pipe(Effect.repeat(Schedule.spaced(TICK)), Effect.forkScoped);
});

export const layer = Layer.effectDiscard(make);
