/* oxlint-disable shadcn/no-unknown-classes -- Baton file predating the rule (D82) */
/**
 * The model and reasoning effort of a Claude Code session running in a terminal, changed from the
 * thread. The session is told with its own `/model` and `/effort` commands in its Herdr pane, and
 * the toast says what the session itself answered, never what was only typed. A session that is not
 * in Herdr offers to be brought in first.
 */
import { LIVE_EFFORT_CHOICES, LIVE_MODEL_CHOICES } from "@t3tools/baton-shared/liveModel";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { ChevronDownIcon, SlidersHorizontalIcon } from "lucide-react";
import { useState } from "react";

import { batonWorkSessions } from "../../state/batonWorkSessions";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { toastManager } from "../ui/toast";

const HEADER_CONTROL = "shrink-0 [-webkit-app-region:no-drag]";
// baton-live4: is the current namespace; the older ones were retired but the id shape is the same.
export const liveSessionIdOf = (threadId: string): string | null =>
  /^baton-live\d*:/.test(threadId) ? threadId.replace(/^baton-live\d*:/, "") : null;

/** Model and effort changes of a mirrored terminal session, applied inside that session (never a new one). */
export function useLiveSessionChange(threadRef: ScopedThreadRef | null) {
  const sessionId = threadRef === null ? null : liveSessionIdOf(threadRef.threadId);
  const setModel = useAtomCommand(batonWorkSessions.liveSetModel, { reportFailure: false });
  const adopt = useAtomCommand(batonWorkSessions.liveAdopt, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const environmentId: EnvironmentId | null = threadRef?.environmentId ?? null;

  const apply = (wanted: { model?: string; effort?: string }) => {
    if (environmentId === null || sessionId === null) return;
    setBusy(true);
    void setModel({ environmentId, input: { sessionId, ...wanted } }).then((result) => {
      setBusy(false);
      if (result._tag !== "Success") {
        toastManager.add({ type: "error", title: "Could not reach the session" });
        return;
      }
      const { state, detail, confirmed } = result.value;
      if (state === "applied") {
        toastManager.add({
          type: "success",
          title: "The session confirmed it",
          description: confirmed.join(" "),
        });
      } else if (state === "not_in_herdr") {
        toastManager.add({
          type: "warning",
          title: "This session is not in Herdr",
          description: detail,
          actionProps: {
            children: "Bring it in",
            onClick: () => {
              void adopt({ environmentId, input: { sessionId: sessionId } }).then((adopted) => {
                if (adopted._tag === "Success" && adopted.value.adopted) apply(wanted);
                else {
                  toastManager.add({
                    type: "error",
                    title: "Could not bring it into Herdr",
                    description:
                      adopted._tag === "Success" ? adopted.value.detail : "It did not answer.",
                  });
                }
              });
            },
          },
        });
      } else {
        toastManager.add({
          type: state === "busy" ? "warning" : "error",
          title: state === "busy" ? "It is working" : "Not changed",
          description: detail,
        });
      }
    });
  };
  return { sessionId, busy, apply };
}

export function BatonLiveModel({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const { sessionId, busy, apply } = useLiveSessionChange(threadRef);
  if (sessionId === null) return null;

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="xs"
            variant="ghost"
            className={HEADER_CONTROL}
            disabled={busy}
            data-testid="live-model"
            aria-label="Model and effort for this session"
          />
        }
      >
        <SlidersHorizontalIcon />
        Model
        <ChevronDownIcon />
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuGroup>
          <MenuGroupLabel>Model</MenuGroupLabel>
          {LIVE_MODEL_CHOICES.map((choice) => (
            <MenuItem key={choice.id} onClick={() => apply({ model: choice.id })}>
              {choice.label}
            </MenuItem>
          ))}
        </MenuGroup>
        <span className="block px-2 pb-1 text-2xs text-muted-foreground">
          Claude Code also keeps the model as your default for new sessions.
        </span>
        <MenuGroup>
          <MenuGroupLabel>Effort</MenuGroupLabel>
          {LIVE_EFFORT_CHOICES.map((effort) => (
            <MenuItem key={effort} onClick={() => apply({ effort })}>
              {effort}
            </MenuItem>
          ))}
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}
