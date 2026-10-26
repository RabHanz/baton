/**
 * "Continue with…" (§6.1): move a work session's thread to another provider instance. Since the
 * v2 port this is upstream's `provider.switch` on the same thread (D80).
 */
import type { BatonFleetEntry, EnvironmentId, ProviderInstanceId } from "@t3tools/baton-contracts";
import { ArrowRightLeftIcon, ChevronDownIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { batonWorkSessions } from "../../state/batonWorkSessions";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";

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
    <>
      <Menu>
        <MenuTrigger
          render={
            <Button
              size="compact"
              variant="outline"
              disabled={busy}
              data-testid="sidebar-fleet-continue-with"
              aria-label={`Continue ${props.entry.title} with another account or provider`}
            />
          }
        >
          <ArrowRightLeftIcon />
          Continue with
          <ChevronDownIcon />
        </MenuTrigger>
        <MenuPopup align="start">
          {targets.map((target) => (
            <MenuItem
              key={target.instanceId}
              onClick={() => {
                setBusy(true);
                setNote(null);
                void handoff({
                  environmentId: props.environmentId,
                  input: {
                    id: props.entry.workSessionId,
                    modelSelection: { instanceId: target.instanceId, model: target.model },
                  },
                }).then((result) => {
                  setBusy(false);
                  setNote(
                    result._tag === "Success"
                      ? `Continuing with ${target.label}`
                      : "Could not hand off",
                  );
                });
              }}
            >
              {target.label}
            </MenuItem>
          ))}
        </MenuPopup>
      </Menu>
      {note === null ? null : (
        <span role="status" className="min-w-0 truncate text-xs text-secondary-label">
          {note}
        </span>
      )}
    </>
  );
}
