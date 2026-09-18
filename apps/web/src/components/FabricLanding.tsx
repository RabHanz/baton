import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, FabricFleetEntry } from "@t3tools/contracts";
import {
  buildFleetRows,
  countFleetRows,
  filterFleetRows,
  type FleetRow,
} from "@t3tools/shared/fabricFleetView";
import { useNavigate } from "@tanstack/react-router";
import { MessagesSquareIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { useFabricFleet } from "../fabricFleetResolvers";
import { useNowMinute } from "../hooks/useNowMinute";
import { cn } from "../lib/utils";
import { useFleet } from "../state/fabricWorkSessions";
import { FabricIntentBar } from "./sidebar/FabricIntentBar";
import { RedactedSensitiveText } from "./settings/RedactedSensitiveText";
import { Button } from "./ui/button";
import { SidebarInset } from "./ui/sidebar";
import { WorkspacePageHeader } from "./WorkspacePageHeader";
import { isElectron } from "../env";

/**
 * What everything is doing, as the first screen.
 *
 * Upstream's index route drops straight into a draft thread, which is the right
 * answer when a person opens an editor to write one thing. It is the wrong
 * answer for somebody running several machines and several accounts at once:
 * the first question then is "what happened while I was away, and what needs
 * me", and that used to live in a sidebar strip under everything else.
 *
 * The sentence input sits above the fleet because it is how the fleet is
 * addressed — "what needs me" and "stop the scheduler" act on the list they sit
 * above.
 */
export function FabricLanding({
  onSelectWorkSession,
}: {
  readonly onSelectWorkSession?: (environmentId: EnvironmentId, entry: FabricFleetEntry) => void;
}): ReactNode {
  const fleet = useFabricFleet();
  const navigate = useNavigate();
  const [needsUserOnly, setNeedsUserOnly] = useState(false);
  // A sentence that runs changes the fleet, and the fleet stream repaints it.
  const [, setIntentRuns] = useState(0);

  const openThread = (environmentId: EnvironmentId, entry: FabricFleetEntry) => {
    if (onSelectWorkSession !== undefined) {
      onSelectWorkSession(environmentId, entry);
      return;
    }
    const threadId = entry.activeThreadId ?? entry.threads[0]?.threadId ?? null;
    if (threadId === null) return;
    const ref = scopeThreadRef(environmentId, threadId);
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId: ref.environmentId, threadId: ref.threadId },
    });
  };

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">Work</span>
          </div>
        </WorkspacePageHeader>
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 overflow-y-auto px-6 py-8">
          {fleet.environmentIds.map((environmentId) => (
            <EnvironmentFleetPanel
              key={environmentId}
              environmentId={environmentId}
              fleet={fleet}
              needsUserOnly={needsUserOnly}
              onToggleNeedsUser={setNeedsUserOnly}
              onIntentRan={() => setIntentRuns((runs) => runs + 1)}
              onOpenThread={openThread}
            />
          ))}
        </div>
      </div>
    </SidebarInset>
  );
}

function EnvironmentFleetPanel({
  environmentId,
  fleet,
  needsUserOnly,
  onToggleNeedsUser,
  onIntentRan,
  onOpenThread,
}: {
  readonly environmentId: EnvironmentId;
  readonly fleet: ReturnType<typeof useFabricFleet>;
  readonly needsUserOnly: boolean;
  readonly onToggleNeedsUser: (next: boolean) => void;
  readonly onIntentRan: () => void;
  readonly onOpenThread: (environmentId: EnvironmentId, entry: FabricFleetEntry) => void;
}): ReactNode {
  const { entries } = useFleet(environmentId);
  // Staleness is a clock, so it needs a ticking one rather than a reading taken
  // during render.
  const nowMinute = useNowMinute();
  const rows = buildFleetRows({
    entries: entries.map((entry) => ({ environmentId, entry })),
    resolveProjectLabel: fleet.resolveProjectLabel,
    resolveEnvironmentLabel: fleet.resolveEnvironmentLabel,
    resolveProviderAccount: fleet.resolveProviderAccount,
    now: Date.parse(`${nowMinute}:00Z`),
  });
  const counts = countFleetRows(rows);
  const visible = filterFleetRows(rows, needsUserOnly);
  const byWorkSession = new Map(entries.map((entry) => [entry.workSessionId, entry]));
  const machine = fleet.resolveEnvironmentLabel(environmentId);

  return (
    <section data-testid="fabric-landing-environment" className="flex flex-col gap-3">
      <div className="rounded-lg border border-border bg-card/40 p-2">
        {/* Nothing is focused on the landing view: there is no open thread
            here, so "tell it to stop" has to name its target. */}
        <FabricIntentBar
          environmentId={environmentId}
          focusedWorkSessionId={null}
          onRan={onIntentRan}
        />
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium text-foreground">{machine ?? "This machine"}</h2>
        <button
          type="button"
          data-testid="fabric-landing-needs-me"
          aria-pressed={needsUserOnly}
          onClick={() => onToggleNeedsUser(!needsUserOnly)}
          className={cn(
            "rounded px-2 py-0.5 text-xs leading-5",
            needsUserOnly ? "bg-accent text-accent-foreground" : "text-muted-foreground",
          )}
        >
          {counts.needsUser === 0 ? "Needs me" : `Needs me · ${counts.needsUser}`}
        </button>
      </div>
      {visible.length === 0 ? (
        <EmptyFleet needsUserOnly={needsUserOnly} hasWork={rows.length > 0} />
      ) : (
        <ul className="flex flex-col divide-y divide-border/70 rounded-lg border border-border">
          {visible.map((row) => (
            <FleetLandingRow
              key={row.key}
              row={row}
              onOpen={() => {
                const entry = byWorkSession.get(row.workSessionId);
                if (entry !== undefined) onOpenThread(environmentId, entry);
              }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * An empty fleet is not an error, and on a machine with history it is usually
 * one action from not being empty — so it names that action rather than saying
 * "nothing here".
 */
function EmptyFleet({
  needsUserOnly,
  hasWork,
}: {
  readonly needsUserOnly: boolean;
  readonly hasWork: boolean;
}): ReactNode {
  const navigate = useNavigate();
  if (needsUserOnly && hasWork) {
    return (
      <p className="rounded-lg border border-border px-4 py-6 text-center text-sm text-muted-foreground">
        Nothing needs you.
      </p>
    );
  }
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-8 text-center">
      <p className="text-sm text-muted-foreground">
        No work yet. Say what you want above, or bring a conversation you have already had.
      </p>
      <Button
        size="sm"
        variant="outline"
        onClick={() => void navigate({ to: "/settings/connections" })}
      >
        <MessagesSquareIcon />
        Import conversations
      </Button>
    </div>
  );
}

function FleetLandingRow({
  row,
  onOpen,
}: {
  readonly row: FleetRow;
  readonly onOpen: () => void;
}): ReactNode {
  return (
    <li>
      <button
        type="button"
        data-testid="fabric-landing-row"
        onClick={onOpen}
        className="flex w-full items-baseline gap-2.5 px-4 py-3 text-left hover:bg-accent/40"
      >
        <span
          aria-hidden
          className={cn(
            "w-3 shrink-0 text-center text-xs leading-5",
            row.needsUser ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {row.glyph}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className="truncate text-sm leading-5 text-foreground">{row.heading}</span>
            <span className="shrink-0 text-xs leading-5 text-muted-foreground">
              {row.stateLabel}
            </span>
          </span>
          {row.attribution === null && row.detail === null ? null : (
            <span className="mt-0.5 block truncate text-xs leading-5 text-muted-foreground">
              {[row.attribution, row.detail].filter((part) => part !== null).join(" · ")}
              {row.detail !== null && row.detailStale ? " (stale)" : ""}
            </span>
          )}
          {row.account?.email == null ? null : (
            <span
              data-testid="fabric-landing-row-account"
              className="mt-0.5 block max-w-full text-xs leading-5 text-muted-foreground"
              onClick={(event) => event.stopPropagation()}
            >
              <RedactedSensitiveText
                value={row.account.email}
                ariaLabel="Toggle account email visibility"
                revealTooltip="Click to reveal the account this is running as"
                hideTooltip="Click to hide the account"
                className="max-w-full truncate"
              />
            </span>
          )}
        </span>
      </button>
    </li>
  );
}
