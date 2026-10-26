/**
 * Baton's projects in T3's own sidebar vocabulary (D72): one entry per project across both boxes
 * and every account, its live sessions as rows shaped like upstream's thread rows, T3's status
 * pills, and one Send composer for the selected session.
 */
import type {
  BatonFleetEntry,
  BatonProjectRef,
  EnvironmentId,
  ProjectId,
} from "@t3tools/baton-contracts";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { FolderIcon, PaperclipIcon, SendHorizontalIcon } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import {
  batonRowStatusPill,
  buildBatonProjects,
  type BatonProjectGroup,
  type BatonSessionRow,
} from "../../batonProjects";
import { batonWorkSessions, useBatonFleets } from "../../state/batonWorkSessions";
import { useAtomCommand } from "../../state/use-atom-command";
import { cn } from "~/lib/utils";
import { ProjectFavicon } from "../ProjectFavicon";
import { ThreadStatusLabel } from "../ThreadStatusIndicators";
import { Button } from "../ui/button";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { Textarea } from "../ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { BatonContinueWith, type HandoffTarget } from "./BatonContinueWith";

export interface BatonProjectsBlockProps {
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
  /** The T3 project a Baton project key names, for its favicon. */
  readonly resolveProjectForKey: (key: string) => EnvironmentProject | null;
  readonly onOpenWorkSession: (environmentId: EnvironmentId, entry: BatonFleetEntry) => void;
  readonly listHandoffTargets: (environmentId: EnvironmentId) => ReadonlyArray<HandoffTarget>;
}

const rowAccount = (props: BatonProjectsBlockProps, row: BatonSessionRow): string | null =>
  row.kind === "claude"
    ? row.account
    : row.kind === "work"
      ? props.resolveWorkAccount(row.environmentId, row.entry)
      : null;

const rowWhere = (row: BatonSessionRow): string =>
  row.kind === "claude" ? row.where : row.kind === "pane" ? "Herdr" : "T3";

export function BatonProjectsBlock(props: BatonProjectsBlockProps): ReactNode {
  const fleets = useBatonFleets(props.environmentIds);
  const [expanded, setExpanded] = useState(true);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const groups = buildBatonProjects({
    environments: fleets.flatMap(({ environmentId, fleet }) =>
      fleet === null
        ? []
        : [
            {
              environmentId,
              environmentLabel: props.resolveEnvironmentLabel(environmentId) ?? environmentId,
              entries: fleet.entries,
              herdr: fleet.herdr ?? [],
              claude: fleet.claudeSessions ?? [],
            },
          ],
    ),
    resolveWorkProject: props.resolveWorkProject,
  });
  const rows = groups.flatMap((group) => group.rows.map((row) => ({ row, group })));
  // The first session is selected until the user picks one, so the composer always has a target.
  const selected =
    rows.find((entry) => entry.row.key === selectedKey) ?? rows.find(() => true) ?? null;

  return (
    <div data-testid="sidebar-baton-projects" className="px-2 pb-1">
      <CollapsibleSectionHeader
        expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        accessory={<span className="font-normal tabular-nums">{rows.length}</span>}
      >
        Projects
      </CollapsibleSectionHeader>
      {expanded ? (
        <>
          <ul className="flex flex-col gap-px">
            {groups.map((group) => (
              <ProjectEntry
                key={group.key}
                group={group}
                selectedKey={selected?.row.key ?? null}
                onSelect={setSelectedKey}
                {...props}
              />
            ))}
          </ul>
          {selected === null ? null : (
            <Composer
              key={selected.row.key}
              row={selected.row}
              title={
                selected.group.rows.length === 1
                  ? `${selected.group.label} · ${selected.row.title}`
                  : selected.row.title
              }
              {...props}
            />
          )}
        </>
      ) : null}
    </div>
  );
}

function ProjectEntry(
  props: BatonProjectsBlockProps & {
    readonly group: BatonProjectGroup;
    readonly selectedKey: string | null;
    readonly onSelect: (key: string) => void;
  },
): ReactNode {
  const { group } = props;
  const project = props.resolveProjectForKey(group.key);
  const icon = project ? (
    <ProjectFavicon project={project} className="size-4" />
  ) : (
    <FolderIcon aria-hidden className="size-4 text-sidebar-muted-foreground" />
  );
  if (group.rows.length === 1) {
    const row = group.rows[0]!;
    return (
      <li data-testid="sidebar-baton-project" className="list-none">
        <SessionRow
          {...props}
          row={row}
          label={`${group.label} · ${row.title}`}
          leading={icon}
          selected={props.selectedKey === row.key}
        />
      </li>
    );
  }
  return (
    <li data-testid="sidebar-baton-project" className="list-none">
      <div className="flex h-8 items-center gap-2.5 px-2.5 text-sm text-sidebar-foreground">
        <span className="flex shrink-0 items-center">{icon}</span>
        <span className="min-w-0 flex-1 truncate font-medium">{group.label}</span>
        <span className="shrink-0 text-xs text-secondary-label tabular-nums">
          {[
            `${group.rows.length} live`,
            group.boxes.join(" + "),
            group.accounts.length > 1 ? `${group.accounts.length} accounts` : null,
          ]
            .filter((part) => part !== null)
            .join(" · ")}
        </span>
      </div>
      <ul className="flex flex-col gap-px">
        {group.rows.map((row) => (
          <li key={row.key} className="list-none">
            <SessionRow
              {...props}
              row={row}
              label={row.title}
              leading={<span aria-hidden className="size-4" />}
              selected={props.selectedKey === row.key}
            />
          </li>
        ))}
      </ul>
    </li>
  );
}

function SessionRow(
  props: BatonProjectsBlockProps & {
    readonly row: BatonSessionRow;
    readonly label: string;
    readonly leading: ReactNode;
    readonly selected: boolean;
    readonly onSelect: (key: string) => void;
  },
): ReactNode {
  const { row } = props;
  const pill = batonRowStatusPill(row);
  const account = rowAccount(props, row);
  const detail = [row.box, account, rowWhere(row)].filter((part) => part !== null).join(" · ");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            data-testid="sidebar-baton-session"
            data-session-key={row.key}
            aria-pressed={props.selected}
            onClick={() => props.onSelect(row.key)}
            onDoubleClick={() => {
              if (row.kind === "work") props.onOpenWorkSession(row.environmentId, row.entry);
            }}
            className={cn(
              "group/sidebar-row relative flex h-9 w-full cursor-pointer items-center gap-2.5 overflow-hidden rounded-md px-2.5 text-left text-sm outline-none select-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              props.selected
                ? "bg-sidebar-row-selected text-sidebar-foreground light:ring-1 light:ring-inset light:ring-sidebar-border/70"
                : "text-sidebar-foreground hover:bg-sidebar-row-hover",
            )}
          />
        }
      >
        <span className="flex shrink-0 items-center">{props.leading}</span>
        <span className="min-w-0 flex-1 truncate">{props.label}</span>
        {pill ? <ThreadStatusLabel status={pill} compact /> : null}
        <span className="max-w-24 shrink-0 truncate text-xs text-secondary-label">
          {account ?? row.box}
        </span>
      </TooltipTrigger>
      <TooltipPopup side="right">{detail}</TooltipPopup>
    </Tooltip>
  );
}

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.readAsDataURL(file);
  });

/** One composer, addressed to the selected session; what it offers depends on what that is. */
function Composer(
  props: BatonProjectsBlockProps & { readonly row: BatonSessionRow; readonly title: string },
): ReactNode {
  const { row } = props;
  const [note, setNote] = useState<string | null>(null);
  const pane = row.kind === "work" ? null : row.pane;
  const prompt = row.kind === "work" ? null : row.prompt;
  return (
    <div
      data-testid="sidebar-baton-composer"
      className="mt-1.5 rounded-lg border border-sidebar-border bg-background p-1.5 dark:bg-input/32"
    >
      <p className="truncate px-1 pb-1 text-xs text-secondary-label">
        To <span className="font-medium text-sidebar-foreground">{props.title}</span>
      </p>
      {prompt === null ? null : (
        <pre className="mb-1 max-h-24 overflow-hidden whitespace-pre-wrap rounded-md bg-sidebar-row-hover px-2 py-1 font-mono text-2xs leading-4 text-sidebar-foreground">
          {prompt}
        </pre>
      )}
      {pane !== null ? (
        <SendForm
          environmentId={row.environmentId}
          pane={pane}
          title={props.title}
          onNote={setNote}
        />
      ) : row.kind === "claude" ? (
        <AdoptAction environmentId={row.environmentId} sessionId={row.sessionId} onNote={setNote} />
      ) : row.kind === "work" ? (
        <div className="flex items-center gap-1.5 px-1">
          <Button
            size="compact"
            variant="outline"
            onClick={() => props.onOpenWorkSession(row.environmentId, row.entry)}
          >
            Open thread
          </Button>
          <BatonContinueWith
            environmentId={row.environmentId}
            entry={row.entry}
            targets={props.listHandoffTargets(row.environmentId)}
          />
        </div>
      ) : null}
      {note === null ? null : (
        <p role="status" className="truncate px-1 pt-1 text-xs text-secondary-label">
          {note}
        </p>
      )}
    </div>
  );
}

function SendForm(props: {
  readonly environmentId: EnvironmentId;
  readonly pane: string;
  readonly title: string;
  readonly onNote: (note: string | null) => void;
}): ReactNode {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
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
        props.onNote(saved._tag === "Success" ? saved.value.detail : "File not sent");
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
      props.onNote("Sent");
    } else {
      props.onNote(result._tag === "Success" ? result.value.detail : "Not sent");
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Textarea
        size="sm"
        rows={2}
        data-testid="sidebar-baton-send-input"
        aria-label={`Send to ${props.title}`}
        value={text}
        placeholder={file === null ? "Send to this session" : `Send with ${file.name}`}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void submit();
          }
        }}
      />
      <div className="flex items-center gap-1 pt-1">
        <Button
          type="button"
          size="icon-sm"
          variant="ghost-muted"
          aria-label="Attach a file or image"
          onClick={() => fileInput.current?.click()}
        >
          <PaperclipIcon />
        </Button>
        <input
          ref={fileInput}
          data-testid="sidebar-baton-send-file"
          type="file"
          className="hidden"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
        <span className="min-w-0 flex-1 truncate text-xs text-secondary-label">
          {file?.name ?? ""}
        </span>
        <Button type="submit" size="compact" aria-label="Send">
          <SendHorizontalIcon />
          Send
        </Button>
      </div>
    </form>
  );
}

function AdoptAction(props: {
  readonly environmentId: EnvironmentId;
  readonly sessionId: string;
  readonly onNote: (note: string | null) => void;
}): ReactNode {
  const adopt = useAtomCommand(batonWorkSessions.liveAdopt, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-center gap-1.5 px-1">
      <span className="min-w-0 flex-1 text-xs text-secondary-label">
        It runs in a terminal or VS Code, where Baton cannot type.
      </span>
      <Button
        size="compact"
        variant="outline"
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
            props.onNote(result._tag === "Success" ? result.value.detail : "Could not adopt");
          });
        }}
      >
        Bring into Herdr
      </Button>
    </div>
  );
}
