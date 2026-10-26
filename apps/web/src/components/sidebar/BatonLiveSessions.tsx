/**
 * Every running session on one environment, from any harness and any account,
 * each with a one-field send (D68). Herdr panes and Claude Code sessions living
 * in them are typed into through Herdr; a session in a plain terminal or VS Code
 * is listed with its state and account, and says how to bring it into Baton.
 */
import type { AdoptedSessionCandidate, ClaudeLiveSession, EnvironmentId } from "@t3tools/contracts";
import { useState, type ReactNode } from "react";

import { batonWorkSessions } from "../../state/batonWorkSessions";
import { useAtomCommand } from "../../state/use-atom-command";
import { cn } from "~/lib/utils";

const leaf = (path: string): string => path.split("/").filter(Boolean).pop() ?? path;

export function BatonLiveSessions(props: {
  readonly environmentId: EnvironmentId;
  readonly herdr: ReadonlyArray<AdoptedSessionCandidate>;
  readonly claude: ReadonlyArray<ClaudeLiveSession>;
}): ReactNode {
  if (props.herdr.length === 0 && props.claude.length === 0) return null;
  const claudeByPane = new Map(
    props.claude.filter((s) => s.herdrPane !== null).map((s) => [s.herdrPane as string, s]),
  );
  const outside = props.claude.filter((s) => s.herdrPane === null);
  const panes = props.herdr.toSorted(
    (a, b) => Number(b.state === "needs_input") - Number(a.state === "needs_input"),
  );
  return (
    <div data-testid="sidebar-live-sessions" className="pt-2">
      <p className="px-2 text-[11px] leading-4 text-sidebar-muted-foreground">Running here</p>
      {panes.map((pane) => {
        const claude = claudeByPane.get(pane.location.pane) ?? null;
        return (
          <LiveRow
            key={pane.location.pane}
            environmentId={props.environmentId}
            title={claude?.name ?? pane.label}
            state={pane.state === "needs_input" ? "blocked" : (pane.state ?? pane.runtimeState)}
            urgent={pane.state === "needs_input"}
            detail={[
              claude === null ? pane.location.workspace : leaf(claude.cwd),
              pane.agentKind,
              claude?.account ?? null,
              "Herdr",
            ]
              .filter((part) => part !== null)
              .join(" · ")}
            prompt={pane.blockedPrompt ?? null}
            sendTo={pane.location.pane}
          />
        );
      })}
      {outside.map((session) => (
        <LiveRow
          key={session.sessionId}
          environmentId={props.environmentId}
          title={session.name ?? leaf(session.cwd)}
          state={session.status ?? "running"}
          urgent={false}
          detail={[leaf(session.cwd), "claude", session.account, session.entrypoint]
            .filter((part) => part !== null)
            .join(" · ")}
          prompt={null}
          sendTo={null}
          hint={`Not in Herdr yet. Close it there, then run: baton --resume ${session.sessionId}`}
        />
      ))}
    </div>
  );
}

function LiveRow(props: {
  readonly environmentId: EnvironmentId;
  readonly title: string;
  readonly state: string;
  readonly urgent: boolean;
  readonly detail: string;
  readonly prompt: string | null;
  readonly sendTo: string | null;
  readonly hint?: string;
}): ReactNode {
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const send = useAtomCommand(batonWorkSessions.herdrSend, { reportFailure: false });
  const submit = () => {
    if (props.sendTo === null || text.trim().length === 0) return;
    const pane = props.sendTo;
    void send({ environmentId: props.environmentId, input: { pane, text } }).then((result) => {
      if (result._tag === "Success" && result.value.delivered) {
        setText("");
        setNote("Sent");
      } else {
        setNote(result._tag === "Success" ? result.value.detail : "Not sent");
      }
    });
  };
  return (
    <div data-testid="sidebar-live-session" className="px-2 py-1">
      <span className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs leading-5 text-sidebar-foreground">{props.title}</span>
        <span
          className={cn(
            "shrink-0 text-[11px] leading-4",
            props.urgent ? "text-sidebar-destructive-foreground" : "text-sidebar-muted-foreground",
          )}
        >
          {props.state}
        </span>
      </span>
      <span className="block truncate text-[11px] leading-4 text-sidebar-muted-foreground">
        {props.detail}
      </span>
      {props.prompt === null ? null : (
        <pre className="mt-0.5 max-h-24 overflow-hidden whitespace-pre-wrap rounded bg-sidebar-accent px-1.5 py-1 text-[10px] leading-3.5 text-sidebar-foreground">
          {props.prompt}
        </pre>
      )}
      {props.sendTo === null ? (
        props.hint === undefined ? null : (
          <span className="block text-[11px] leading-4 text-sidebar-muted-foreground">
            {props.hint}
          </span>
        )
      ) : (
        <form
          className="mt-0.5 flex gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <textarea
            data-testid="sidebar-live-session-input"
            aria-label={`Send to ${props.title}`}
            rows={1}
            value={text}
            placeholder="Send…"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            className="min-w-0 flex-1 resize-y rounded border border-sidebar-border bg-transparent px-1.5 py-1 text-xs text-sidebar-foreground"
          />
          <button
            type="submit"
            className="shrink-0 rounded border border-sidebar-border px-2 text-xs text-sidebar-foreground"
          >
            Send
          </button>
        </form>
      )}
      {note === null ? null : (
        <span className="block text-[11px] leading-4 text-sidebar-muted-foreground">{note}</span>
      )}
    </div>
  );
}
