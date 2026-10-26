/**
 * "Continue with…" (§6.1, D62): move a work session to another provider
 * instance. The server builds the capsule, starts the thread in the same
 * worktree and closes the previous one onto the timeline.
 */
import type { EnvironmentId, BatonFleetEntry, ProviderInstanceId } from "@t3tools/contracts";
import { newThreadId } from "~/lib/utils";
import { useState, type ReactNode } from "react";

import { batonWorkSessions } from "../../state/batonWorkSessions";
import { useAtomCommand } from "../../state/use-atom-command";

export interface HandoffTarget {
  readonly instanceId: ProviderInstanceId;
  readonly label: string;
  readonly model: string;
}

export function BatonContinueWith(props: {
  readonly environmentId: EnvironmentId;
  readonly entry: BatonFleetEntry;
  readonly targets: ReadonlyArray<HandoffTarget>;
}): ReactNode {
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const handoff = useAtomCommand(batonWorkSessions.handoff, { reportFailure: false });
  const activeInstance =
    props.entry.threads.find((thread) => thread.threadId === props.entry.activeThreadId)
      ?.providerInstanceId ?? null;
  const targets = props.targets.filter((target) => target.instanceId !== activeInstance);
  if (targets.length === 0) return null;
  return (
    <div className="flex items-center gap-1 px-2 pb-1 pl-6">
      <select
        data-testid="sidebar-fleet-continue-with"
        aria-label={`Continue ${props.entry.title} with another account or provider`}
        disabled={busy}
        value=""
        onChange={(event) => {
          const target = targets.find((entry) => entry.instanceId === event.target.value);
          if (target === undefined) return;
          setBusy(true);
          setNote(null);
          void handoff({
            environmentId: props.environmentId,
            input: {
              id: props.entry.workSessionId,
              threadId: newThreadId(),
              modelSelection: { instanceId: target.instanceId, model: target.model },
            },
          }).then((result) => {
            setBusy(false);
            setNote(
              result._tag === "Success" ? `Continuing with ${target.label}` : "Could not hand off",
            );
          });
        }}
        className="min-w-0 rounded border border-sidebar-border bg-transparent px-1 py-0.5 text-[11px] text-sidebar-muted-foreground"
      >
        <option value="">Continue with…</option>
        {targets.map((target) => (
          <option key={target.instanceId} value={target.instanceId}>
            {target.label}
          </option>
        ))}
      </select>
      {note === null ? null : (
        <span className="truncate text-[11px] text-sidebar-muted-foreground">{note}</span>
      )}
    </div>
  );
}
