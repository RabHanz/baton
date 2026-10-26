/**
 * "On this machine": the conversations that exist here but are not yet threads.
 *
 * The import dialog was the previous answer, and it is the wrong shape for what
 * he asked for. A dialog is a thing you go and open; he asked for his projects
 * and their sessions to *be* in T3. So the same listing lives in the sidebar,
 * without being asked, and states the gap as a count rather than hiding it.
 *
 * Three deliberate refusals here, each one a defect if it went the other way:
 *
 *   - a running conversation is never offered. Its transcript is the only copy,
 *     and resuming it would put a second writer on that file. The row says
 *     "running" and does nothing when clicked.
 *   - the block is collapsed by default, showing only what is running. This box
 *     holds 7,071 transcripts against one project; a section that listed them
 *     all above his thread list would bury the thing it exists to surface.
 *   - a session whose directory belongs to no project is still listed, last,
 *     and says so. That is the one gap the user can act on, and it is exactly
 *     the kind a tidier listing would have dropped.
 *
 * It is additive: the thread list below is untouched, for the same reason the
 * work-session block is additive — its ordering and drag-and-drop machinery is
 * load-bearing and folding another row type into it is a separate change.
 */
import { useAtomValue } from "@effect/atom-react";
import { CommandId, type EnvironmentId, type ProjectId, type ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { useMemo, useState, type ReactNode } from "react";

import {
  buildSessionPresence,
  sessionPresenceSummary,
  type SessionPresenceGroup,
  type SessionPresenceRow,
} from "../../fabricSessionPresence";
import { cn, newProjectId } from "../../lib/utils";
import { agentSessionImportThread, agentSessionThreads } from "../../state/agentSessions";
import { readProjects } from "../../state/entities";
import { projectEnvironment } from "../../state/projects";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { workspaceRootTitle } from "../settings/ImportConversationsDialog.logic";

export interface SessionPresenceSectionProps {
  /** Only environments that advertise `agentSessionConversationImport`. */
  readonly environmentIds: readonly EnvironmentId[];
  readonly resolveProjectLabel: (
    environmentId: EnvironmentId,
    projectId: ProjectId,
  ) => string | null;
  readonly onOpenThread: (environmentId: EnvironmentId, threadId: ThreadId) => void;
}

export function SessionPresenceSection(props: SessionPresenceSectionProps): ReactNode {
  if (props.environmentIds.length === 0) return null;
  return (
    <div data-testid="sidebar-session-presence" className="flex flex-col gap-px pb-2">
      {props.environmentIds.map((environmentId) => (
        <EnvironmentPresence key={environmentId} environmentId={environmentId} {...props} />
      ))}
    </div>
  );
}

function EnvironmentPresence(
  props: SessionPresenceSectionProps & { readonly environmentId: EnvironmentId },
): ReactNode {
  const [expanded, setExpanded] = useState(false);
  const listAtom = useMemo(
    () => agentSessionThreads({ environmentId: props.environmentId, input: {} }),
    [props.environmentId],
  );
  const result = useAtomValue(listAtom);
  const listing = Option.getOrNull(AsyncResult.value(result));

  const view = useMemo(
    () =>
      buildSessionPresence({
        threads: listing?.threads ?? [],
        knownThreadIds: new Set(),
        resolveProjectLabel: (projectId) =>
          props.resolveProjectLabel(props.environmentId, projectId),
      }),
    // `props.resolveProjectLabel` is stable per render of the sidebar; the
    // listing is what actually changes.
    [listing, props, props.environmentId],
  );

  if (view.counts.discovered === 0) return null;

  const visibleGroups = expanded ? view.groups : runningOnly(view.groups);
  const hiddenCount = view.counts.onDisk;

  return (
    <div className="px-2 py-1">
      <button
        type="button"
        data-testid="sidebar-session-presence-summary"
        className="block w-full truncate text-left text-[11px] leading-4 text-sidebar-muted-foreground"
        onClick={() => setExpanded((current) => !current)}
      >
        {`On this machine — ${sessionPresenceSummary(view.counts)}`}
      </button>
      {visibleGroups.map((group) => (
        <PresenceGroupRows
          key={group.projectId ?? group.workspaceRoot}
          group={group}
          environmentId={props.environmentId}
          onOpenThread={props.onOpenThread}
        />
      ))}
      {!expanded && hiddenCount > 0 ? (
        <button
          type="button"
          data-testid="sidebar-session-presence-expand"
          className="block w-full truncate pl-2 text-left text-[11px] leading-4 text-sidebar-muted-foreground"
          onClick={() => setExpanded(true)}
        >
          {`Show ${hiddenCount} conversation${hiddenCount === 1 ? "" : "s"} on disk`}
        </button>
      ) : null}
    </div>
  );
}

/** Collapsed, the block is about right now: only what something is writing to. */
function runningOnly(groups: readonly SessionPresenceGroup[]): readonly SessionPresenceGroup[] {
  return groups.flatMap((group) => {
    const rows = group.rows.filter((row) => row.state === "running");
    return rows.length === 0 ? [] : [{ ...group, rows }];
  });
}

function PresenceGroupRows(props: {
  readonly group: SessionPresenceGroup;
  readonly environmentId: EnvironmentId;
  readonly onOpenThread: (environmentId: EnvironmentId, threadId: ThreadId) => void;
}): ReactNode {
  const importThread = useAtomCommand(agentSessionImportThread, { reportFailure: false });
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [failure, setFailure] = useState("");

  const open = async (row: SessionPresenceRow) => {
    // The refusal that matters: its transcript is the only copy.
    if (row.state === "running" || busyKey !== null) return;
    setBusyKey(row.key);
    setFailure("");
    const projectId = row.projectId ?? (await createProjectForRow(row));
    if (projectId === null) {
      setBusyKey(null);
      return;
    }
    const imported = await importThread({
      environmentId: props.environmentId,
      input: {
        projectId,
        provider: row.provider,
        providerInstanceId: row.providerInstanceId,
        providerSessionId: row.providerSessionId,
        expectedWorkspaceRoot: props.group.workspaceRoot,
      },
    });
    setBusyKey(null);
    if (imported._tag !== "Success") {
      setFailure("Could not open that conversation.");
      return;
    }
    props.onOpenThread(props.environmentId, imported.value.threadId as ThreadId);
  };

  /** A session with no project needs one before it can be anything. */
  const createProjectForRow = async (row: SessionPresenceRow): Promise<ProjectId | null> => {
    const workspaceRoot = props.group.workspaceRoot;
    const existing = readProjects().find(
      (project) =>
        project.environmentId === props.environmentId && project.workspaceRoot === workspaceRoot,
    );
    if (existing) return existing.id;
    const projectId = newProjectId();
    const created = await createProject({
      environmentId: props.environmentId,
      input: {
        projectId,
        commandId: CommandId.make(`session-presence:project:${projectId}`),
        title: workspaceRootTitle(workspaceRoot),
        workspaceRoot,
        createWorkspaceRootIfMissing: false,
        defaultModelSelection: null,
      },
    });
    if (created._tag !== "Success") {
      setFailure(`Could not add ${workspaceRoot}.`);
      return null;
    }
    void row;
    return projectId;
  };

  return (
    <div className="pt-1">
      <p className="truncate text-[11px] leading-4 text-sidebar-muted-foreground">
        {props.group.projectLabel ?? `${props.group.workspaceRoot} — no project yet`}
      </p>
      {props.group.rows.map((row) => (
        <button
          key={row.key}
          type="button"
          data-testid="sidebar-session-presence-row"
          data-state={row.state}
          disabled={row.state === "running"}
          title={
            row.state === "running"
              ? "Still being written. Opening it would put a second writer on the only copy."
              : (row.sessionRoot ?? props.group.workspaceRoot)
          }
          className={cn(
            "block w-full truncate pl-2 text-left text-[11px] leading-4",
            row.state === "running"
              ? "cursor-default text-sidebar-foreground"
              : "text-sidebar-muted-foreground",
          )}
          onClick={() => void open(row)}
        >
          {presenceRowLabel(row, busyKey === row.key)}
        </button>
      ))}
      {failure === "" ? null : (
        <p className="truncate pl-2 text-[11px] leading-4 text-sidebar-destructive-foreground">
          {failure}
        </p>
      )}
    </div>
  );
}

/**
 * The line a row shows: what the conversation was, then its state, then when.
 * "running" is a state and not a verb the user can act on, which is the point.
 */
export function presenceRowLabel(row: SessionPresenceRow, busy: boolean): string {
  const state = busy ? "opening" : row.state === "running" ? "running" : "on disk";
  const where = row.nested && row.sessionRoot !== null ? ` · ${lastSegment(row.sessionRoot)}` : "";
  return `${row.title} — ${state}${where} · ${formatRelativeTimeLabel(row.lastActiveAt)}`;
}

function lastSegment(directory: string): string {
  const parts = directory.split("/").filter((part) => part !== "");
  return parts.at(-1) ?? directory;
}
