/**
 * Each account's limits in the shape Baton's own window shows them (D140). The numbers are T3's own
 * `usageLimits` on each provider; nothing is read twice or guessed. A window an account does not
 * report is `usedPercent: null` ("Not applicable"), as the tile says (D126).
 */
import type { BatonUsageSummary } from "@t3tools/baton-contracts";

interface ProviderLike {
  readonly instanceId: string;
  readonly displayName?: string | undefined;
  readonly enabled: boolean;
  readonly usageLimits?:
    | {
        readonly windows: ReadonlyArray<{
          readonly kind: "session" | "weekly" | "monthly" | "other";
          readonly label: string;
          readonly usedPercent: number;
          readonly resetsAt?: string | undefined;
        }>;
      }
    | undefined;
}

const KIND_LABEL = { session: "Session", weekly: "Week", monthly: "Month" } as const;

export function batonUsageSummaries(
  environments: ReadonlyArray<{
    readonly box: string;
    readonly providers: ReadonlyArray<ProviderLike>;
  }>,
): ReadonlyArray<BatonUsageSummary> {
  return environments.flatMap((env) =>
    env.providers.flatMap((provider): ReadonlyArray<BatonUsageSummary> => {
      const limits = provider.usageLimits;
      if (!provider.enabled || limits === undefined || limits.windows.length === 0) return [];
      const windows = limits.windows.map((w) => ({
        label: w.kind === "other" ? w.label : KIND_LABEL[w.kind],
        usedPercent: w.usedPercent,
        resetsAt: w.resetsAt ?? null,
      }));
      return [{ account: provider.displayName ?? provider.instanceId, box: env.box, windows }];
    }),
  );
}
