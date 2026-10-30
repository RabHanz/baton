/**
 * The account a thread runs as, and one click to change it (D92). Threads on the default Claude
 * instance share whatever cswap has active on their environment, so the switch moves all of them at
 * their next turn; a token instance is pinned and only its label shows here.
 */
import { useAtomValue } from "@effect/atom-react";
import type { BatonAccount } from "@t3tools/baton-contracts";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import type { ScopedThreadRef } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { CheckIcon, ChevronDownIcon, UserRoundIcon } from "lucide-react";
import { useState } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { batonWorkSessions } from "../../state/batonWorkSessions";
import { useQuietThreadShell } from "../../state/entities";
import { useEnvironmentProviders } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { limitsAge } from "./BatonLimitsAge";

const HEADER_CONTROL = "shrink-0 [-webkit-app-region:no-drag]";

export function accountRow(account: BatonAccount, now: number): string {
  const room =
    account.headroomPercent === null ? "limits unknown" : `${account.headroomPercent}% left`;
  const age = account.usageCheckedAt === null ? null : limitsAge(account.usageCheckedAt, now);
  return age === null ? room : `${room} · ${age.text.toLowerCase()}`;
}

export function BatonThreadAccount({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const shell = useQuietThreadShell(threadRef);
  const providers = useEnvironmentProviders().get(threadRef.environmentId) ?? [];
  const provider = providers.find((entry) => entry.instanceId === shell?.providerInstanceId);
  const pool = useAtomValue(
    batonWorkSessions.accountPoolQuery({ environmentId: threadRef.environmentId, input: {} }),
  );
  const use = useAtomCommand(batonWorkSessions.accountUse, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const nowMinute = useNowMinute();
  if (shell === null || provider?.driver !== "claudeAgent") return null;

  const pinned = shell.providerInstanceId !== "claudeAgent";
  if (pinned) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={<span className={`${HEADER_CONTROL} text-xs text-muted-foreground`} />}
        >
          {provider.displayName ?? shell.providerInstanceId}
        </TooltipTrigger>
        <TooltipPopup>
          This thread is pinned to this account. Change it in the model picker.
        </TooltipPopup>
      </Tooltip>
    );
  }

  const accounts = Option.getOrNull(AsyncResult.value(pool))?.accounts ?? [];
  const active = accounts.find((account) => account.active);
  if (active === undefined) return null;
  const running = threadRuntimeIsActive(shell.runtime);
  const now = Date.parse(`${nowMinute}:00Z`);

  const switchTo = (account: BatonAccount) => {
    setBusy(true);
    void use({
      environmentId: threadRef.environmentId,
      input: { key: account.key, reason: "manual" },
    }).then((result) => {
      setBusy(false);
      toastManager.add(
        result._tag === "Success"
          ? {
              type: "success",
              title: `Now running as ${account.label}`,
              description: "Claude threads on this environment move at their next turn.",
            }
          : { type: "error", title: `Could not switch to ${account.label}` },
      );
    });
  };

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="xs"
            variant="ghost"
            className={HEADER_CONTROL}
            disabled={busy}
            data-testid="thread-account"
            aria-label={`Running as ${active.label}. Switch account`}
          />
        }
      >
        <UserRoundIcon />
        {active.label}
        <ChevronDownIcon />
      </MenuTrigger>
      <MenuPopup align="end">
        {accounts.map((account) => (
          <MenuItem
            key={account.key}
            disabled={account.active || running || account.unusableReason === "signed-out"}
            onClick={() => switchTo(account)}
          >
            {account.active ? <CheckIcon /> : <span className="size-4" aria-hidden />}
            <span className="flex min-w-0 flex-col">
              <span>{account.label}</span>
              <span className="text-2xs text-muted-foreground">{accountRow(account, now)}</span>
            </span>
          </MenuItem>
        ))}
        {running ? (
          <span className="block px-2 py-1 text-2xs text-muted-foreground">
            Switch once this turn ends.
          </span>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}
