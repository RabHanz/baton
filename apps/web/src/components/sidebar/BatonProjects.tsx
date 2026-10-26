/**
 * The sidebar's one surface (D72): one entry per project, across both boxes and
 * every account, with each live session under it. A project with one live
 * session is one line. The account and the box are attributes of a session,
 * never a separate place to look.
 */
import type {
  BatonFleetEntry,
  BatonProjectRef,
  EnvironmentId,
  ProjectId,
} from "@t3tools/contracts";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  buildBatonProjects,
  type BatonSessionRow,
  type EnvironmentLive,
} from "../../batonProjects";
import { batonWorkSessions, useFleet } from "../../state/batonWorkSessions";
import { useAtomCommand } from "../../state/use-atom-command";
import { cn } from "~/lib/utils";
import { BatonContinueWith, type HandoffTarget } from "./BatonContinueWith";

export interface BatonProjectsProps {
  readonly environmentIds: readonly EnvironmentId[];
  readonly resolveEnvironmentLabel: (environmentId: EnvironmentId) => string | null;
  readonly resolveWorkProject: (
    environmentId: EnvironmentId,
    projectId: ProjectId,
  ) => BatonProjectRef | null;
  readonly resolveWorkAccount: (
    environmentId: EnvironmentId,
    entry: BatonFleetEntry,
  ) => string | null;
  readonly onSelectWorkSession: (environmentId: EnvironmentId, entry: BatonFleetEntry) => void;
  readonly listHandoffTargets?: (environmentId: EnvironmentId) => ReadonlyArray<HandoffTarget>;
}

/** Reads one environment's fleet and reports it up; renders nothing. */
function EnvironmentCollector(props: {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly onChange: (live: EnvironmentLive) => void;
}): ReactNode {
  const { entries, herdr, claude } = useFleet(props.environmentId);
  const onChange = useRef(props.onChange);
  useEffect(() => {
    onChange.current = props.onChange;
  });
  useEffect(() => {
    onChange.current({
      environmentId: props.environmentId,
      environmentLabel: props.label,
      entries,
      herdr,
      claude,
    });
  }, [props.environmentId, props.label, entries, herdr, claude]);
  return null;
}

export function BatonProjects(props: BatonProjectsProps): ReactNode {
  const [live, setLive] = useState<Readonly<Record<string, EnvironmentLive>>>({});
  const groups = useMemo(
    () =>
      buildBatonProjects({
        environments: props.environmentIds.flatMap((id) => (live[id] ? [live[id]] : [])),
        resolveWorkProject: props.resolveWorkProject,
      }),
    [live, props.environmentIds, props.resolveWorkProject],
  );
  return (
    <div data-testid="sidebar-baton-projects" className="pt-2">
      {props.environmentIds.map((id) => (
        <EnvironmentCollector
          key={id}
          environmentId={id}
          label={props.resolveEnvironmentLabel(id) ?? id}
          onChange={(next) => setLive((prev) => ({ ...prev, [id]: next }))}
        />
      ))}
      {groups.length === 0 ? null : (
        <p className="px-2 pb-1 text-2xs font-medium uppercase tracking-wide text-sidebar-muted-foreground">
          Projects
        </p>
      )}
      {groups.map((group) => (
        <div key={group.key} data-testid="sidebar-baton-project" className="pb-1.5">
          {group.rows.length === 1 ? (
            // One live session: the project is that session, on one line.
            <SessionRow row={group.rows[0]!} projectLabel={group.label} {...props} />
          ) : (
            <>
              <div className="flex items-baseline justify-between gap-2 px-2">
                <span className="truncate text-xs font-medium leading-5 text-sidebar-foreground">
                  {group.label}
                </span>
                <span className="shrink-0 text-2xs leading-4 text-sidebar-muted-foreground">
                  {[
                    `${group.rows.length} live`,
                    group.boxes.join(" + "),
                    group.accounts.length > 1 ? `${group.accounts.length} accounts` : null,
                  ]
                    .filter((part) => part !== null)
                    .join(" · ")}
                </span>
              </div>
              {group.rows.map((row) => (
                <SessionRow key={row.key} row={row} {...props} />
              ))}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.readAsDataURL(file);
  });

function SessionRow(
  props: BatonProjectsProps & { readonly row: BatonSessionRow; readonly projectLabel?: string },
): ReactNode {
  const { row } = props;
  const title =
    props.projectLabel === undefined ? row.title : `${props.projectLabel} · ${row.title}`;
  const account =
    row.kind === "claude"
      ? row.account
      : row.kind === "work"
        ? props.resolveWorkAccount(row.environmentId, row.entry)
        : null;
  const detail = [
    row.box,
    account,
    row.kind === "claude" ? row.where : row.kind === "pane" ? "Herdr" : "T3",
  ]
    .filter((part) => part !== null)
    .join(" · ");
  return (
    <div
      data-testid="sidebar-baton-session"
      data-session-key={row.key}
      className={cn("py-0.5 pr-2", props.projectLabel === undefined ? "pl-4" : "pl-2")}
    >
      <span className="flex items-baseline justify-between gap-2">
        {row.kind === "work" ? (
          <button
            type="button"
            className="truncate text-left text-xs leading-5 text-sidebar-foreground"
            onClick={() => props.onSelectWorkSession(row.environmentId, row.entry)}
          >
            {title}
          </button>
        ) : (
          <span className="truncate text-xs leading-5 text-sidebar-foreground">{title}</span>
        )}
        <span
          className={cn(
            "shrink-0 text-2xs leading-4",
            row.urgent ? "text-destructive" : "text-sidebar-muted-foreground",
          )}
        >
          {row.state}
        </span>
      </span>
      <span className="block truncate text-2xs leading-4 text-sidebar-muted-foreground">
        {detail}
      </span>
      {row.kind !== "work" && row.prompt !== null ? (
        <pre className="mt-0.5 max-h-24 overflow-hidden whitespace-pre-wrap rounded bg-sidebar-row-selected px-1.5 py-1 text-3xs leading-3.5 text-sidebar-foreground">
          {row.prompt}
        </pre>
      ) : null}
      {row.kind === "work" ? (
        props.listHandoffTargets === undefined ? null : (
          <BatonContinueWith
            environmentId={row.environmentId}
            entry={row.entry}
            targets={props.listHandoffTargets(row.environmentId)}
          />
        )
      ) : row.pane !== null ? (
        <SendBox environmentId={row.environmentId} pane={row.pane} title={title} />
      ) : row.kind === "claude" ? (
        <AdoptButton environmentId={row.environmentId} sessionId={row.sessionId} />
      ) : null}
    </div>
  );
}

function AdoptButton(props: {
  readonly environmentId: EnvironmentId;
  readonly sessionId: string;
}): ReactNode {
  const adopt = useAtomCommand(batonWorkSessions.liveAdopt, { reportFailure: false });
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-0.5 flex items-center gap-1.5">
      <button
        type="button"
        data-testid="sidebar-baton-adopt"
        disabled={busy}
        onClick={() => {
          if (
            !window.confirm("Close it where it runs now and reopen the same conversation in Herdr?")
          ) {
            return;
          }
          setBusy(true);
          void adopt({
            environmentId: props.environmentId,
            input: { sessionId: props.sessionId },
          }).then((result) => {
            setBusy(false);
            setNote(result._tag === "Success" ? result.value.detail : "Could not adopt");
          });
        }}
        className="rounded border border-sidebar-border px-2 py-0.5 text-2xs text-sidebar-foreground"
      >
        Bring into Herdr to send
      </button>
      {note === null ? null : (
        <span className="truncate text-2xs text-sidebar-muted-foreground">{note}</span>
      )}
    </div>
  );
}

function SendBox(props: {
  readonly environmentId: EnvironmentId;
  readonly pane: string;
  readonly title: string;
}): ReactNode {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const send = useAtomCommand(batonWorkSessions.herdrSend, { reportFailure: false });
  const attach = useAtomCommand(batonWorkSessions.liveAttach, { reportFailure: false });
  const fileInput = useRef<HTMLInputElement>(null);

  const submit = async () => {
    if (text.trim().length === 0 && file === null) return;
    let message = text;
    if (file !== null) {
      const saved = await attach({
        environmentId: props.environmentId,
        input: {
          target: { pane: props.pane },
          fileName: file.name,
          dataBase64: await fileToBase64(file),
        },
      });
      if (saved._tag !== "Success" || !saved.value.saved || saved.value.path === null) {
        setNote(saved._tag === "Success" ? saved.value.detail : "File not sent");
        return;
      }
      // Claude Code reads a file it is shown as `@path`; a shell gets the path as is.
      message = `${text.trim().length === 0 ? "Look at this file:" : text} @${saved.value.path}`;
    }
    const result = await send({
      environmentId: props.environmentId,
      input: { pane: props.pane, text: message },
    });
    if (result._tag === "Success" && result.value.delivered) {
      setText("");
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      setNote("Sent");
    } else {
      setNote(result._tag === "Success" ? result.value.detail : "Not sent");
    }
  };

  return (
    <>
      <form
        className="mt-0.5 flex gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <textarea
          data-testid="sidebar-baton-send-input"
          aria-label={`Send to ${props.title}`}
          rows={1}
          value={text}
          placeholder={file === null ? "Send…" : `Send with ${file.name}…`}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
          className="min-w-0 flex-1 resize-y rounded border border-sidebar-border bg-transparent px-1.5 py-1 text-xs text-sidebar-foreground"
        />
        <label className="flex shrink-0 cursor-pointer items-center rounded border border-sidebar-border px-1.5 text-xs text-sidebar-foreground">
          <span aria-hidden>+</span>
          <span className="sr-only">Attach a file or image</span>
          <input
            ref={fileInput}
            data-testid="sidebar-baton-send-file"
            type="file"
            className="hidden"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <button
          type="submit"
          className="shrink-0 rounded border border-sidebar-border px-2 text-xs text-sidebar-foreground"
        >
          Send
        </button>
      </form>
      {note === null ? null : (
        <span className="block text-2xs leading-4 text-sidebar-muted-foreground">{note}</span>
      )}
    </>
  );
}
