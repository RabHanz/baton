/**
 * "Switch to this account" in a limits tile's popover (D94). cswap is per machine, so a tile merged
 * across environments gets a row for each, and a spent account shows why it cannot be clicked.
 */
import { useAtomValue } from "@effect/atom-react";
import type { BatonAccount } from "@t3tools/baton-contracts";
import type { LimitAccount } from "@t3tools/shared/usageLimits";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";

import { batonWorkSessions } from "../../state/batonWorkSessions";
import { Button } from "../ui/button";
import { useAccountSwitch } from "./BatonThreadAccount";

function blockedReason(account: BatonAccount): string | null {
  if (account.active) return "In use";
  if (account.headroomPercent === 0) return "Spent";
  if (account.unusableReason === "signed-out") return "Signed out";
  if (account.unusableReason === "disabled") return "Held out";
  return null;
}

function SwitchRow({
  environment,
  accountKey,
  showEnvironment,
}: {
  readonly environment: LimitAccount["environments"][number];
  readonly accountKey: string;
  readonly showEnvironment: boolean;
}) {
  const pool = useAtomValue(
    batonWorkSessions.accountPoolQuery({ environmentId: environment.environmentId, input: {} }),
  );
  const { busy, switchTo } = useAccountSwitch(environment.environmentId);
  const accounts = Option.getOrNull(AsyncResult.value(pool))?.accounts ?? [];
  const target = accounts.find((account) => account.key === accountKey);
  if (target === undefined) return null;
  const blocked = blockedReason(target);
  return (
    <span className="flex min-h-6 items-center gap-2 text-muted-foreground">
      <span className="min-w-0 truncate">
        {[showEnvironment ? environment.label : null, blocked].filter(Boolean).join(" · ")}
      </span>
      <Button
        size="xs"
        variant="outline"
        className="ms-auto shrink-0"
        disabled={busy || blocked !== null}
        data-testid="tile-switch-account"
        onClick={() => switchTo(target)}
      >
        Switch to this account
      </Button>
    </span>
  );
}

export function BatonTileSwitch({ account }: { readonly account: LimitAccount }) {
  const accountKey = account.limits.credentialFingerprint;
  if (account.driver !== "claudeAgent" || accountKey === undefined) return null;
  return (
    <div className="flex flex-col gap-1 border-t border-border/60 pt-2.5">
      {account.environments.map((environment) => (
        <SwitchRow
          key={environment.environmentId}
          environment={environment}
          accountKey={accountKey}
          showEnvironment={account.environments.length > 1}
        />
      ))}
    </div>
  );
}
