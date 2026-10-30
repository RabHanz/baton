/**
 * Claude limits for setup tokens (D92): `get_usage` gives a token no windows, so cswap's reading from
 * Baton's probe (D90) goes into the provider snapshot. `checkedAt` keeps the reading's own time so the
 * panel can state its age. A login that reports its own windows is left alone.
 */
import type { BatonAccount, BatonAccountPool } from "@t3tools/baton-contracts";
import { ProviderDriverKind, type ServerProviderUsageLimits } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import { makeUsageLimits } from "@t3tools/provider-core/server/usageLimits";

import { makePoolReader } from "./AccountPoolService.ts";

/** cswap slots of the token instances; the same table as scripts/baton/provider-token-instances.py. */
const ACCOUNT_BY_INSTANCE: Readonly<Record<string, string>> = {
  claudeAgent_optima: "5",
  claudeAgent_signzart: "6",
};

const WINDOW_SHAPE: Readonly<
  Record<string, { kind: "session" | "weekly"; label: string; mins: number }>
> = {
  five_hour: { kind: "session", label: "Session", mins: 5 * 60 },
  seven_day: { kind: "weekly", label: "Weekly", mins: 7 * 24 * 60 },
};

/** The account an instance runs as: its token's slot, else whatever cswap has active. */
export function accountForInstance(
  instanceId: string,
  accounts: ReadonlyArray<BatonAccount>,
): BatonAccount | undefined {
  const key = ACCOUNT_BY_INSTANCE[instanceId];
  return key === undefined
    ? accounts.find((account) => account.active)
    : accounts.find((account) => account.key === key);
}

export function limitsFromAccount(
  account: BatonAccount | undefined,
): ServerProviderUsageLimits | undefined {
  if (account === undefined || account.usageCheckedAt === null) return undefined;
  const windows = account.windows.flatMap((window) => {
    const shape = WINDOW_SHAPE[window.id];
    return shape === undefined
      ? []
      : [
          {
            id: window.id,
            kind: shape.kind,
            label: shape.label,
            windowDurationMins: shape.mins,
            usedPercent: window.usedPercent,
            ...(window.resetsAt === null ? {} : { resetsAt: window.resetsAt }),
          },
        ];
  });
  return windows.length === 0
    ? undefined
    : makeUsageLimits({ checkedAt: account.usageCheckedAt, windows });
}

/** Fills in limits only where the login reports none; a missing cswap changes nothing. */
export const withProbeLimits = <
  P extends { readonly usageLimits?: ServerProviderUsageLimits | undefined },
>(
  instanceId: string,
  provider: P,
): Effect.Effect<P, never, ChildProcessSpawner.ChildProcessSpawner> => {
  if (provider.usageLimits?.unavailable?.reason !== "unsupported") return Effect.succeed(provider);
  return Effect.flatMap(ChildProcessSpawner.ChildProcessSpawner, (spawner) =>
    makePoolReader(spawner)(ProviderDriverKind.make("claudeAgent")).pipe(
      Effect.map((pool: BatonAccountPool) => {
        const usageLimits = limitsFromAccount(accountForInstance(instanceId, pool.accounts));
        return usageLimits === undefined ? provider : ({ ...provider, usageLimits } as P);
      }),
      Effect.catchCause(() => Effect.succeed(provider)),
    ),
  );
};
