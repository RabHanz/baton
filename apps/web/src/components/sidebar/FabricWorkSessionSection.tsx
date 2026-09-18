/**
 * The Work block: the sidebar's answer to "what am I working on", above the
 * thread list.
 *
 * The specification's UI principle is work first, provider second. A row reads
 * the project, then the work, then the account and host and status — and never
 * `Claude B Thread 01939…`. The account and host stay visible and stay
 * secondary.
 *
 * It is additive on purpose. The thread list below is untouched: its ordering,
 * drag-and-drop and section machinery are load-bearing, and folding them under
 * work sessions is a separate change with its own risks. A work session whose
 * thread has ended still appears here, which is the whole point of the object
 * and is exactly what the thread list cannot show.
 */
import { type ReactNode } from "react";
import type { EnvironmentId, WorkSession } from "@t3tools/contracts";

import { cn } from "~/lib/utils";
import {
  buildWorkSessionGrouping,
  workSessionThreadSubtitle,
  type WorkSessionGroup,
} from "../../fabricWorkSessionGrouping";
import { useWorkSessions } from "../../state/fabricWorkSessions";
import type { SidebarThreadSummary } from "../../types";

export interface FabricWorkSessionSectionProps {
  /** Only environments that advertise `fabricWorkSessions`. */
  readonly environmentIds: readonly EnvironmentId[];
  readonly threads: ReadonlyArray<SidebarThreadSummary & { readonly environmentId: EnvironmentId }>;
  readonly resolveEnvironmentLabel: (environmentId: EnvironmentId) => string | null;
  readonly resolveProviderLabel: (
    environmentId: EnvironmentId,
    providerInstanceId: string,
  ) => string | null;
  readonly resolveProjectLabel: (
    environmentId: EnvironmentId,
    workSession: WorkSession,
  ) => string | null;
  /** Live status word for a thread, as the thread rows already label it. */
  readonly resolveThreadStatusLabel: (thread: SidebarThreadSummary) => string | null;
  readonly activeThreadKey: string | null;
  readonly onSelectThread: (environmentId: EnvironmentId, thread: SidebarThreadSummary) => void;
}

export function FabricWorkSessionSection(props: FabricWorkSessionSectionProps): ReactNode {
  if (props.environmentIds.length === 0) return null;
  return (
    <div data-testid="sidebar-work-sessions" className="flex flex-col gap-px pb-2">
      {props.environmentIds.map((environmentId) => (
        <EnvironmentWorkSessions key={environmentId} environmentId={environmentId} {...props} />
      ))}
    </div>
  );
}

/**
 * One environment's work. Split into its own component because the
 * subscription is a hook and the number of environments is not fixed.
 */
function EnvironmentWorkSessions(
  props: FabricWorkSessionSectionProps & { readonly environmentId: EnvironmentId },
): ReactNode {
  const { workSessions } = useWorkSessions(props.environmentId);
  if (workSessions.length === 0) return null;

  const grouping = buildWorkSessionGrouping({
    workSessions: workSessions.map((workSession) => ({
      environmentId: props.environmentId,
      workSession,
    })),
    threads: props.threads.filter((thread) => thread.environmentId === props.environmentId),
    resolveEnvironmentLabel: props.resolveEnvironmentLabel,
    resolveProviderLabel: props.resolveProviderLabel,
  });

  return (
    <>
      {grouping.groups.map((group) => (
        <WorkSessionGroupRows
          key={group.workSession.id}
          group={group}
          projectLabel={props.resolveProjectLabel(props.environmentId, group.workSession)}
          resolveThreadStatusLabel={props.resolveThreadStatusLabel}
          activeThreadKey={props.activeThreadKey}
          onSelectThread={props.onSelectThread}
        />
      ))}
    </>
  );
}

function WorkSessionGroupRows(props: {
  readonly group: WorkSessionGroup;
  readonly projectLabel: string | null;
  readonly resolveThreadStatusLabel: (thread: SidebarThreadSummary) => string | null;
  readonly activeThreadKey: string | null;
  readonly onSelectThread: (environmentId: EnvironmentId, thread: SidebarThreadSummary) => void;
}): ReactNode {
  const { group } = props;
  // With no live thread the work still has a line, and it says which account
  // ran it last rather than going blank.
  const dormantSubtitle =
    group.threads.length === 0
      ? workSessionThreadSubtitle({
          providerLabel: group.pastProviderLabels.at(-1) ?? null,
          hostLabel: group.hostLabel,
          statusLabel: group.workSession.status === "settled" ? "Settled" : "No provider",
        })
      : null;

  return (
    <div className="px-2 py-1">
      {props.projectLabel === null ? null : (
        <p className="truncate text-[11px] leading-4 text-sidebar-muted-foreground">
          {props.projectLabel}
        </p>
      )}
      <p className="truncate text-xs font-medium leading-5 text-sidebar-foreground">
        {group.workSession.title}
      </p>
      {dormantSubtitle === null ? null : (
        <p className="truncate pl-2 text-[11px] leading-4 text-sidebar-muted-foreground">
          {dormantSubtitle}
        </p>
      )}
      {group.threads.map((row) => {
        const threadKey = `${group.environmentId}:${row.thread.id}`;
        return (
          <button
            key={row.thread.id}
            type="button"
            data-testid="sidebar-work-session-thread"
            className={cn(
              "block w-full truncate pl-2 text-left text-[11px] leading-4 text-sidebar-muted-foreground",
              props.activeThreadKey === threadKey && "text-sidebar-foreground",
            )}
            onClick={() => props.onSelectThread(group.environmentId, row.thread)}
          >
            {workSessionThreadSubtitle({
              providerLabel: row.providerLabel,
              hostLabel: row.hostLabel,
              statusLabel: props.resolveThreadStatusLabel(row.thread),
            })}
          </button>
        );
      })}
    </div>
  );
}
