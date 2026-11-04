/* oxlint-disable shadcn/no-unknown-classes -- Baton file (D82) */
/**
 * A live thread whose terminal session is not running says so, always, instead of answering with a chat message:
 * the session list is read every 30 s, and a stopped session offers Resume (the same session id comes back).
 */
import type { ScopedThreadRef } from "@t3tools/contracts";
import { bindingBanner } from "@t3tools/baton-shared/liveThread";
import { useEffect, useState } from "react";

import { batonWorkSessions } from "../../state/batonWorkSessions";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { liveSessionIdOf } from "./BatonLiveModel";

const CHECK_MS = 30_000;
type Found = { readonly state: string; readonly source: string } | "missing" | null;

export function BatonLiveBinding({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const sessionId = liveSessionIdOf(threadRef.threadId);
  const list = useAtomCommand(batonWorkSessions.sessionsList, { reportFailure: false });
  const resume = useAtomCommand(batonWorkSessions.sessionsResume, { reportFailure: false });
  const [found, setFound] = useState<Found>(null);
  const [busy, setBusy] = useState(false);
  const { environmentId } = threadRef;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- polls the server's session list, outside React
  useEffect(() => {
    if (sessionId === null) return;
    let cancelled = false;
    const check = () =>
      void list({ environmentId, input: { query: sessionId, limit: 10 } }).then((result) => {
        if (cancelled || result._tag !== "Success") return;
        const row = result.value.sessions.find((entry) => entry.id === sessionId);
        setFound(row === undefined ? "missing" : { state: row.state, source: row.source });
      });
    check();
    const timer = setInterval(check, CHECK_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [environmentId, list, sessionId]);

  const banner = bindingBanner(found);
  if (sessionId === null || banner === null) return null;
  return (
    <span className="flex shrink-0 items-center gap-1" data-testid="thread-not-connected">
      <span className="text-2xs text-warning-foreground">{banner.text}</span>
      <Button
        size="xs"
        variant="outline"
        disabled={busy}
        className="shrink-0 [-webkit-app-region:no-drag]"
        onClick={() => {
          setBusy(true);
          void resume({ environmentId, input: { sessionId } }).then((result) => {
            setBusy(false);
            toastManager.add(
              result._tag === "Success"
                ? {
                    type: "success",
                    title: "Resuming this session",
                    description: "The thread follows it once it runs.",
                  }
                : { type: "error", title: "Could not resume this session" },
            );
          });
        }}
      >
        Resume
      </Button>
    </span>
  );
}
