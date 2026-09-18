/**
 * Fabric work sessions in the web client.
 *
 * Two gates decide whether any of this is live, and they answer different
 * questions:
 *
 *   - the environment's `fabricWorkSessions` capability answers "does this
 *     server understand `fabric.*` at all"; without it the client must not call,
 *     because an older server would reject the request;
 *   - the client setting answers "does this user want the sidebar grouped by
 *     work"; it is off by default while Fabric is being built.
 */
import { useEffect, useMemo, useState } from "react";
import { createFabricWorkSessionAtoms } from "@t3tools/client-runtime/state/fabric-work-sessions";
import type { EnvironmentId, FabricFleetEntry, WorkSession } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../connection/runtime";
import { useEnvironmentQuery } from "./query";
import { useAtomCommand } from "./use-atom-command";

export const fabricWorkSessions = createFabricWorkSessionAtoms(connectionAtomRuntime);

const NO_WORK_SESSIONS: ReadonlyArray<WorkSession> = [];

/**
 * One environment's work sessions. Pass `null` for the environment id when the
 * environment is unknown or has not advertised the capability; the subscription
 * is then never opened.
 */
export function useWorkSessions(environmentId: EnvironmentId | null): {
  readonly workSessions: ReadonlyArray<WorkSession>;
  readonly loaded: boolean;
} {
  const query = useEnvironmentQuery(
    environmentId === null ? null : fabricWorkSessions.workSessions({ environmentId, input: {} }),
  );
  return useMemo(
    () => ({ workSessions: query.data ?? NO_WORK_SESSIONS, loaded: query.data !== undefined }),
    [query.data],
  );
}

const NO_FLEET_ENTRIES: ReadonlyArray<FabricFleetEntry> = [];

/**
 * One environment's fleet, refreshed whenever its work sessions change.
 *
 * The dependency on `workSessions` is the refresh trigger and is deliberate:
 * every server-side change to a work session or a synopsis pushes on that
 * stream, so the fleet re-reads exactly when something moved, and never on a
 * timer.
 */
export function useFleet(environmentId: EnvironmentId | null): {
  readonly entries: ReadonlyArray<FabricFleetEntry>;
  readonly loaded: boolean;
} {
  const { workSessions } = useWorkSessions(environmentId);
  const [read, setRead] = useState<{
    readonly entries: ReadonlyArray<FabricFleetEntry>;
    readonly loaded: boolean;
  }>({ entries: NO_FLEET_ENTRIES, loaded: false });
  const readFleet = useAtomCommand(fabricWorkSessions.fleet, { reportFailure: false });
  // The trigger is "a work session or a synopsis moved", not object identity:
  // the subscription hands back a new array on every event, and re-reading for
  // an unchanged fleet would be a poll with extra steps.
  const signature = useMemo(
    () =>
      workSessions
        .map((entry) => `${entry.id}:${entry.updatedAt}:${entry.synopsis?.updatedAt ?? ""}`)
        .join("|"),
    [workSessions],
  );

  useEffect(() => {
    if (environmentId === null) return;
    // No work sessions means an empty fleet; asking the server to confirm that
    // is a round trip for a known answer. The empty result is derived below
    // rather than written into state here.
    if (signature === "") return;
    let cancelled = false;
    void readFleet({ environmentId, input: {} }).then((result) => {
      if (cancelled) return;
      // A fleet that cannot be read renders as empty rather than as stale: a
      // list that quietly keeps showing the last good answer is the failure
      // §11 names.
      setRead(
        result._tag === "Success"
          ? { entries: result.value.fleet.entries, loaded: true }
          : { entries: NO_FLEET_ENTRIES, loaded: false },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [environmentId, readFleet, signature]);

  // Derived rather than stored, so a disconnected environment and an empty one
  // need no effect to clear what the last read left behind.
  if (environmentId === null) return { entries: NO_FLEET_ENTRIES, loaded: false };
  if (signature === "") return { entries: NO_FLEET_ENTRIES, loaded: true };
  return read;
}
