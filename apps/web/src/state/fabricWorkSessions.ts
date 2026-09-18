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
import { useMemo } from "react";
import { createFabricWorkSessionAtoms } from "@t3tools/client-runtime/state/fabric-work-sessions";
import type { EnvironmentId, WorkSession } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../connection/runtime";
import { useEnvironmentQuery } from "./query";

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
