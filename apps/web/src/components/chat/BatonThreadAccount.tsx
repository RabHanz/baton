/**
 * The account a thread runs as, and how much room it has (D95, L-76). Changing it is the model
 * picker's job: each account is a provider instance, and instances that share transcripts are
 * offered to a started thread there. A mirrored terminal session runs on cswap's machine login,
 * which the Usage page switches.
 */
import { useAtomValue } from "@effect/atom-react";
import { accountReturnsAt, instanceAccount, type BatonAccount } from "@t3tools/baton-contracts";
import { ProviderInstanceId, type ModelSelection, type ScopedThreadRef } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { LockIcon, LockOpenIcon, UserRoundIcon } from "lucide-react";
import { useState } from "react";

import {
  classifierStopReason,
  describeAnswerer,
  isLiveThreadId,
  LIVE_INSTANCE,
} from "@t3tools/baton-shared/liveThread";
import { useComposerDraftStore } from "../../composerDraftStore";
import { useNowMinute } from "../../hooks/useNowMinute";
import { batonWorkSessions } from "../../state/batonWorkSessions";
import { useQuietThreadShell, useThreadVisibleTurnItems } from "../../state/entities";
import { useEnvironmentProviders } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { limitsAge } from "./BatonLimitsAge";
import { BatonLiveBinding } from "./BatonLiveBinding";

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

function AccountLabel({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const shell = useQuietThreadShell(threadRef);
  const providers = useEnvironmentProviders().get(threadRef.environmentId) ?? [];
  const pool = useAtomValue(
    batonWorkSessions.accountPoolQuery({ environmentId: threadRef.environmentId, input: {} }),
  );
  const nowMinute = useNowMinute();
  if (shell === null) return null;
  const provider = providers.find((entry) => entry.instanceId === shell.providerInstanceId);
  const live = isLiveThreadId(threadRef.threadId);
  // A mirrored terminal session runs on cswap's active login.
  const account = live
    ? Option.getOrNull(AsyncResult.value(pool))?.accounts.find((entry) => entry.active)
    : provider?.driver === "claudeAgent"
      ? instanceAccount(provider, true)
      : undefined;
  if (account === undefined) return null;
  return (
    <span
      className="flex shrink-0 items-center gap-1 text-2xs text-muted-foreground"
      data-testid="thread-account"
    >
      <UserRoundIcon className="size-3.5" aria-hidden />
      {account.label} · {accountRow(account, Date.parse(`${nowMinute}:00Z`))}
      {live ? null : <KeepToggle threadRef={threadRef} />}
    </span>
  );
}

/** "Keep on this account": automatic rotation leaves this thread where he put it. */
function KeepToggle({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const query = useAtomValue(
    batonWorkSessions.threadKeptQuery({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    }),
  );
  const setKeep = useAtomCommand(batonWorkSessions.threadKeep, { reportFailure: false });
  const [chosen, setChosen] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const stored = Option.getOrNull(AsyncResult.value(query))?.keep ?? null;
  // An older server has no such setting.
  if (stored === null) return null;
  const keep = chosen ?? stored;
  const toggle = () => {
    setBusy(true);
    void setKeep({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, keep: !keep },
    }).then((result) => {
      setBusy(false);
      if (result._tag === "Success") setChosen(result.value.keep);
      else
        toastManager.add({
          type: "error",
          title: "Could not change this thread's account setting",
        });
    });
  };
  return (
    <Button
      size="xs"
      variant="ghost"
      className={HEADER_CONTROL}
      disabled={busy}
      aria-pressed={keep}
      data-testid="thread-account-keep"
      onClick={toggle}
    >
      {keep ? <LockIcon /> : <LockOpenIcon />}
      {keep ? "Kept on this account" : "Keep on this account"}
    </Button>
  );
}

/** Who answers this thread, and a banner when a live thread has been handed to a new session. */
function LiveAnswerer({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const shell = useQuietThreadShell(threadRef);
  const pool = useAtomValue(
    batonWorkSessions.accountPoolQuery({ environmentId: threadRef.environmentId, input: {} }),
  );
  const live = isLiveThreadId(threadRef.threadId);
  const items = useThreadVisibleTurnItems(live ? threadRef : null);
  if (shell === null || !live) return null;
  const lastItem = items.at(-1)?.item;
  const stopped = classifierStopReason(
    lastItem?.type === "assistant_message" ? lastItem.text : null,
  );
  const accounts = Option.getOrNull(AsyncResult.value(pool))?.accounts ?? [];
  const options = shell.modelSelection.options;
  const effort = Array.isArray(options)
    ? options.find((option) => option.id === "effort" || option.id === "reasoningEffort")?.value
    : undefined;
  const answerer = describeAnswerer({
    threadId: threadRef.threadId,
    instanceId: shell.providerInstanceId,
    model: shell.modelSelection.model,
    effort: typeof effort === "string" ? effort : null,
    account: accounts.find((account) => account.active)?.label ?? null,
  });
  return (
    <>
      <span
        className="min-w-0 shrink truncate text-2xs text-muted-foreground"
        data-testid="thread-answerer"
      >
        {answerer.line}
      </span>
      {stopped === null ? null : (
        <span
          className="shrink-0 text-2xs text-warning-foreground"
          data-testid="thread-classifier-stop"
        >
          {stopped}
        </span>
      )}
      {answerer.handedOff ? (
        <Button
          size="xs"
          variant="outline"
          className={HEADER_CONTROL}
          data-testid="thread-handoff-banner"
          onClick={() =>
            useComposerDraftStore.getState().setModelSelection(threadRef, {
              ...shell.modelSelection,
              instanceId: ProviderInstanceId.make(LIVE_INSTANCE),
            } as ModelSelection)
          }
        >
          This thread is now answered by a new session (summary handoff). Switch back
        </Button>
      ) : null}
    </>
  );
}

export function BatonThreadAccount({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  return (
    <>
      <LiveAnswerer threadRef={threadRef} />
      <BatonLiveBinding threadRef={threadRef} />
      <AccountLabel threadRef={threadRef} />
    </>
  );
}
