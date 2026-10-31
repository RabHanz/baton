/**
 * The account a thread runs as, and one click to change it for this thread alone (D95). Each
 * account is a provider instance and their homes share transcripts, so the thread keeps its
 * conversation; during a turn the server holds the move until the turn ends. A mirrored terminal
 * session is not ours to restart, so it keeps cswap's machine-wide switch (D92).
 */
import { useAtomValue } from "@effect/atom-react";
import {
  accountForInstance,
  accountRefusal,
  accountReturnsAt,
  BATON_DEFAULT_CLAUDE_INSTANCE,
  instanceForAccount,
  type BatonAccount,
} from "@t3tools/baton-contracts";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { CheckIcon, ChevronDownIcon, RotateCwIcon, UserRoundIcon } from "lucide-react";
import { useState } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { batonWorkSessions } from "../../state/batonWorkSessions";
import { useQuietThreadShell } from "../../state/entities";
import { useEnvironmentProviders } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { toastManager } from "../ui/toast";
import { limitsAge } from "./BatonLimitsAge";

const HEADER_CONTROL = "shrink-0 [-webkit-app-region:no-drag]";

export function accountRow(account: BatonAccount, now: number): string {
  const returnsAt = accountReturnsAt(account);
  if (returnsAt !== null) {
    const when = new Date(returnsAt).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    return `out until ${when}`;
  }
  const room =
    account.headroomPercent === null ? "limits unknown" : `${account.headroomPercent}% left`;
  const age = account.usageCheckedAt === null ? null : limitsAge(account.usageCheckedAt, now);
  return age === null ? room : `${room} · ${age.text.toLowerCase()}`;
}

/** cswap's switch on one environment; it moves every Claude thread there at its next turn. */
export function useAccountSwitch(environmentId: EnvironmentId) {
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
              title: `Now running as ${account.label}`,
              description: "Claude threads on this environment move at their next turn.",
            }
          : { type: "error", title: `Could not switch to ${account.label}` },
      );
    });
  };
  return { busy, switchTo };
}

/** cswap's switch on one environment; it moves every session that follows the active account. */
export function useAccountSwitch(environmentId: EnvironmentId) {
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
              title: `Now running as ${account.label}`,
              description: "Sessions on this environment that follow it move at their next turn.",
            }
          : { type: "error", title: `Could not switch to ${account.label}` },
      );
    });
  };
  return { busy, switchTo };
}

export function BatonThreadAccount({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const shell = useQuietThreadShell(threadRef);
  const providers = useEnvironmentProviders().get(threadRef.environmentId) ?? [];
  const provider = providers.find((entry) => entry.instanceId === shell?.providerInstanceId);
  const pool = useAtomValue(
    batonWorkSessions.accountPoolQuery({ environmentId: threadRef.environmentId, input: {} }),
  );
  const machine = useAccountSwitch(threadRef.environmentId);
  const useForThread = useAtomCommand(batonWorkSessions.threadAccountUse, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const nowMinute = useNowMinute();
  // A mirrored terminal session has Baton's live instance, and runs on the same cswap account.
  const live = threadRef.threadId.startsWith("baton-live");
  if (shell === null || (!live && provider?.driver !== "claudeAgent")) return null;

  const accounts = Option.getOrNull(AsyncResult.value(pool))?.accounts ?? [];
  const current = accountForInstance(shell.providerInstanceId, accounts);
  if (current === undefined) return null;
  const running = threadRuntimeIsActive(shell.runtime);
  const now = Date.parse(`${nowMinute}:00Z`);
  const onDefault = shell.providerInstanceId === BATON_DEFAULT_CLAUDE_INSTANCE;
  const isAvailable = (instanceId: string) =>
    providers.some((entry) => entry.instanceId === instanceId && entry.enabled);

  const switchThread = (key: string | null, label: string) => {
    setBusy(true);
    void useForThread({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, key },
    }).then((result) => {
      setBusy(false);
      toastManager.add(
        result._tag === "Success"
          ? result.value.timing === "now"
            ? { type: "success", title: `This thread now runs as ${label}` }
            : {
                type: "success",
                title: `This thread moves to ${label} when the turn ends`,
                description: "The running turn is not interrupted.",
              }
          : { type: "error", title: `Could not switch to ${label}` },
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
            disabled={busy || machine.busy}
            data-testid="thread-account"
            aria-label={`Running as ${current.label}. Switch account`}
          />
        }
      >
        <UserRoundIcon />
        {current.label}
        <ChevronDownIcon />
      </MenuTrigger>
      <MenuPopup align="end">
        {accounts.map((account) => {
          const isCurrent = account.key === current.key;
          const blocked =
            isCurrent ||
            accountRefusal(account) !== null ||
            (live ? running : instanceForAccount(account, isAvailable) === null);
          return (
            <MenuItem
              key={account.key}
              disabled={blocked}
              onClick={() =>
                live ? machine.switchTo(account) : switchThread(account.key, account.label)
              }
            >
              {isCurrent ? <CheckIcon /> : <span className="size-4" aria-hidden />}
              <span className="flex min-w-0 flex-col">
                <span>{account.label}</span>
                <span className="text-2xs text-muted-foreground">{accountRow(account, now)}</span>
              </span>
            </MenuItem>
          );
        })}
        {live || onDefault ? null : (
          <>
            <MenuSeparator />
            <MenuItem onClick={() => switchThread(null, "the active account")}>
              <RotateCwIcon />
              Follow this machine's active account
            </MenuItem>
          </>
        )}
        {live && running ? (
          <span className="block px-2 py-1 text-2xs text-muted-foreground">
            Switch once this turn ends.
          </span>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}
