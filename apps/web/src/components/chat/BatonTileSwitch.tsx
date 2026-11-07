/**
 * "Use for terminal sessions" in a limits tile (D94). His terminal sessions run on cswap's machine
 * login, which T3 threads do not need since L-76; this goes when terminal sessions resume natively.
 * cswap is per machine, so a tile merged across environments gets a row for each.
 */
import { useAtomValue } from "@effect/atom-react";
import type { BatonAccount } from "@t3tools/baton-contracts";
import type { EnvironmentId } from "@t3tools/contracts";
import type { LimitAccount } from "@t3tools/shared/usageLimits";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";

import { batonWorkSessions } from "../../state/batonWorkSessions";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";

function useAccountSwitch(environmentId: EnvironmentId) {
  const use = useAtomCommand(batonWorkSessions.accountUse, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const switchTo = (account: BatonAccount) => {
    setBusy(true);
    void use({ environmentId, input: { key: account.key, reason: "manual" } }).then((result) => {
      setBusy(false);
      toastManager.add(
        result._tag === "Success"
          ? {
              type: "success",
              title: `Terminal sessions now run as ${account.label}`,
              description: "This machine's Claude login. They pick it up when they restart.",
            }
          : { type: "error", title: `Could not switch to ${account.label}` },
      );
    });
  };
  return { busy, switchTo };
}

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
        Use for terminal sessions
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
