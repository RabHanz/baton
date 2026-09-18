/**
 * The Fleet: what everything is doing, at the top of the sidebar.
 *
 * §33's shape and §33's rule that "Needs me" is a **top-level filter** — one
 * control, always visible, that reduces the list to the work that cannot move
 * without the user. It is not a search box and not buried in a menu.
 *
 * Every state here was derived by the environment from its own events. The
 * client renders; it does not decide what "working" means.
 */
import { type ReactNode, useState } from "react";
import type { EnvironmentId, FabricFleetEntry, ProjectId } from "@t3tools/contracts";

import { cn } from "~/lib/utils";
import {
  buildFleetRows,
  countFleetRows,
  filterFleetRows,
  type FleetRow,
} from "../../fabricFleetView";
import { useNowMinute } from "../../hooks/useNowMinute";
import { focusedWorkSessionFromThreads } from "../../fabricContextView";
import { useFleet } from "../../state/fabricWorkSessions";
import { FabricIntentBar } from "./FabricIntentBar";

export interface FabricFleetSectionProps {
  /** Only environments that advertise `fabricWorkSessions`. */
  readonly environmentIds: readonly EnvironmentId[];
  readonly resolveEnvironmentLabel: (environmentId: EnvironmentId) => string | null;
  readonly resolveProviderLabel: (
    environmentId: EnvironmentId,
    providerInstanceId: string,
  ) => string | null;
  readonly resolveProjectLabel: (
    environmentId: EnvironmentId,
    projectId: ProjectId,
  ) => string | null;
  readonly onSelectWorkSession: (environmentId: EnvironmentId, entry: FabricFleetEntry) => void;
  /** Bumped after a sentence runs, so the intent log re-reads. */
  readonly onIntentRan: () => void;
  /** The thread the route has open, as `<environmentId>:<threadId>`. */
  readonly activeThreadKey: string | null;
}

export function FabricFleetSection(props: FabricFleetSectionProps): ReactNode {
  const [needsUserOnly, setNeedsUserOnly] = useState(false);
  if (props.environmentIds.length === 0) return null;
  return (
    <div
      data-testid="sidebar-fleet"
      className="flex flex-col gap-px border-b border-sidebar-border pb-2"
    >
      {props.environmentIds.map((environmentId) => (
        <EnvironmentFleet
          key={environmentId}
          environmentId={environmentId}
          needsUserOnly={needsUserOnly}
          onToggleNeedsUser={setNeedsUserOnly}
          {...props}
        />
      ))}
    </div>
  );
}

function EnvironmentFleet(
  props: FabricFleetSectionProps & {
    readonly environmentId: EnvironmentId;
    readonly needsUserOnly: boolean;
    readonly onToggleNeedsUser: (next: boolean) => void;
  },
): ReactNode {
  const { entries } = useFleet(props.environmentId);
  // Staleness is a clock, so it needs a ticking one rather than a reading taken
  // during render: `Date.now()` here would freeze the moment a row last
  // rendered, and a synopsis would never *become* stale on screen.
  const nowMinute = useNowMinute();

  const rows = buildFleetRows({
    entries: entries.map((entry) => ({ environmentId: props.environmentId, entry })),
    resolveProjectLabel: props.resolveProjectLabel,
    resolveEnvironmentLabel: props.resolveEnvironmentLabel,
    resolveProviderLabel: props.resolveProviderLabel,
    // `useNowMinute` yields "2026-09-18T04:59", and a date-time with no offset
    // parses as local rather than UTC — so the zone is made explicit here
    // instead of skewing every age by the machine's offset.
    now: Date.parse(`${nowMinute}:00Z`),
  });
  return (
    <div className="pt-1">
      {/* The input sits above the fleet because it is how the fleet is
          addressed: "what needs me" and "tell the scheduler to stop" are the
          same surface as the list they act on. */}
      <FabricIntentBar
        environmentId={props.environmentId}
        // §14 rung 3, with a producer at last: the work the open thread
        // belongs to. Until this, "tell it to stop" always fell through to
        // whatever moved last.
        focusedWorkSessionId={focusedWorkSessionFromThreads(
          entries,
          props.environmentId,
          props.activeThreadKey,
        )}
        onRan={props.onIntentRan}
      />
      {/* No work yet still gets the input: "start work on X" is exactly the
          sentence someone types into an empty fleet. */}
      {entries.length === 0 ? null : (
        <FleetList
          {...props}
          rows={rows}
          entries={entries}
          needsUserOnly={props.needsUserOnly}
          onToggleNeedsUser={props.onToggleNeedsUser}
        />
      )}
    </div>
  );
}

function FleetList(
  props: FabricFleetSectionProps & {
    readonly environmentId: EnvironmentId;
    readonly needsUserOnly: boolean;
    readonly onToggleNeedsUser: (next: boolean) => void;
    readonly rows: readonly FleetRow[];
    readonly entries: ReadonlyArray<FabricFleetEntry>;
  },
): ReactNode {
  const { rows, entries } = props;
  const counts = countFleetRows(rows);
  const visible = filterFleetRows(rows, props.needsUserOnly);
  const byEntry = new Map(entries.map((entry) => [entry.workSessionId, entry]));

  return (
    <>
      <div className="flex items-center justify-between gap-2 px-2 pb-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-sidebar-muted-foreground">
          Fleet
        </p>
        <button
          type="button"
          data-testid="sidebar-fleet-needs-me"
          aria-pressed={props.needsUserOnly}
          onClick={() => props.onToggleNeedsUser(!props.needsUserOnly)}
          className={cn(
            "rounded px-1.5 py-0.5 text-[11px] leading-4",
            props.needsUserOnly
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-muted-foreground",
          )}
        >
          {counts.needsUser === 0 ? "Needs me" : `Needs me · ${counts.needsUser}`}
        </button>
      </div>
      {visible.length === 0 ? (
        <p className="px-2 pb-1 text-[11px] leading-4 text-sidebar-muted-foreground">
          {props.needsUserOnly ? "Nothing needs you." : "No work yet."}
        </p>
      ) : (
        visible.map((row) => (
          <FleetRowView
            key={row.key}
            row={row}
            onSelect={() => {
              const entry = byEntry.get(row.workSessionId);
              if (entry !== undefined) props.onSelectWorkSession(props.environmentId, entry);
            }}
          />
        ))
      )}
    </>
  );
}

function FleetRowView(props: { readonly row: FleetRow; readonly onSelect: () => void }): ReactNode {
  const { row } = props;
  return (
    <button
      type="button"
      data-testid="sidebar-fleet-row"
      onClick={props.onSelect}
      className="flex w-full items-baseline gap-1.5 px-2 py-0.5 text-left"
    >
      <span
        aria-hidden
        className={cn(
          "w-2 shrink-0 text-center text-[11px] leading-4",
          row.needsUser ? "text-sidebar-destructive-foreground" : "text-sidebar-muted-foreground",
        )}
      >
        {row.glyph}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-xs leading-5 text-sidebar-foreground">{row.heading}</span>
          <span className="shrink-0 text-[11px] leading-4 text-sidebar-muted-foreground">
            {row.stateLabel}
          </span>
        </span>
        {row.attribution === null && row.detail === null ? null : (
          <span className="block truncate text-[11px] leading-4 text-sidebar-muted-foreground">
            {[row.attribution, row.detail].filter((part) => part !== null).join(" · ")}
            {row.detail !== null && row.detailStale ? " (stale)" : ""}
          </span>
        )}
      </span>
    </button>
  );
}
