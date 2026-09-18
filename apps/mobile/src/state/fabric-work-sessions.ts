/**
 * Fabric on the phone.
 *
 * The same atoms the desktop client uses, from `client-runtime`, because §19 is
 * explicit that the phone **remains a client**: it hosts no provider processes
 * and invents no state of its own. Everything here is a read of what an
 * environment already computed, or a command it already accepts.
 *
 * The capability gate matters more here than anywhere: a phone connects to
 * several environments, and one of them being older than `fabric.*` must not
 * make the screen call something that will be rejected.
 */
import { useEffect, useMemo, useState } from "react";
import { createFabricWorkSessionAtoms } from "@t3tools/client-runtime/state/fabric-work-sessions";
import type { EnvironmentId, FabricFleetEntry, WorkSession } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../connection/runtime";
import { useEnvironmentQuery } from "./query";
import { useAtomCommand } from "./use-atom-command";

export const fabricWorkSessions = createFabricWorkSessionAtoms(connectionAtomRuntime);

const NO_WORK_SESSIONS: ReadonlyArray<WorkSession> = [];
const NO_FLEET_ENTRIES: ReadonlyArray<FabricFleetEntry> = [];

/** One environment's work sessions, folded from snapshot plus events. */
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

/**
 * One environment's fleet, re-read whenever its work sessions move.
 *
 * On a phone the alternative — a timer — is worse than on a desktop: it wakes
 * the radio while the screen is off and is wrong between ticks anyway. The
 * work-session stream already fires exactly when something changed.
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
  const signature = useMemo(
    () =>
      workSessions
        .map((entry) => `${entry.id}:${entry.updatedAt}:${entry.synopsis?.updatedAt ?? ""}`)
        .join("|"),
    [workSessions],
  );

  useEffect(() => {
    if (environmentId === null || signature === "") return;
    let cancelled = false;
    void readFleet({ environmentId, input: {} }).then((result) => {
      if (cancelled) return;
      // A fleet that cannot be read renders as empty rather than as stale: a
      // list quietly showing the last good answer is the failure §11 names.
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

  if (environmentId === null) return { entries: NO_FLEET_ENTRIES, loaded: false };
  if (signature === "") return { entries: NO_FLEET_ENTRIES, loaded: true };
  return read;
}

/**
 * Say something to an environment — first what it heard, then, if the words are
 * right, the thing itself.
 *
 * `resolve` is a read: it decides what the words mean and changes nothing, so
 * the phone can show the reading before anything acts on a sentence it may have
 * misheard.
 */
export function useFabricIntent(): {
  readonly resolve: (input: {
    readonly environmentId: EnvironmentId;
    readonly text: string;
    readonly focusedWorkSessionId: string | null;
  }) => Promise<{ readonly line: string; readonly refused: boolean }>;
  readonly run: (input: {
    readonly environmentId: EnvironmentId;
    readonly text: string;
    readonly focusedWorkSessionId: string | null;
  }) => Promise<{ readonly reply: string; readonly ok: boolean }>;
} {
  const resolveIntent = useAtomCommand(fabricWorkSessions.intentResolve, { reportFailure: false });
  const runIntent = useAtomCommand(fabricWorkSessions.intentRun, { reportFailure: false });
  const resolve = async (input: {
    readonly environmentId: EnvironmentId;
    readonly text: string;
    readonly focusedWorkSessionId: string | null;
  }): Promise<{ readonly line: string; readonly refused: boolean }> => {
    const result = await resolveIntent({
      environmentId: input.environmentId,
      input: {
        text: input.text,
        focusedWorkSessionId: input.focusedWorkSessionId as never,
        // A sentence the grammar cannot place is read by a model rather than
        // refused, which is the whole point of pressing send once.
        allowModel: true,
      },
    });
    if (result._tag !== "Success") {
      return { line: "That could not be read. Nothing has run.", refused: true };
    }
    const resolution = result.value.resolution;
    return resolution.outcome === "resolved"
      ? { line: resolution.description, refused: false }
      : { line: resolution.refusal.message, refused: true };
  };
  const run = async (input: {
    readonly environmentId: EnvironmentId;
    readonly text: string;
    readonly focusedWorkSessionId: string | null;
  }): Promise<{ readonly reply: string; readonly ok: boolean }> => {
    const result = await runIntent({
      environmentId: input.environmentId,
      input: {
        text: input.text,
        focusedWorkSessionId: input.focusedWorkSessionId as never,
      },
    });
    return result._tag === "Success"
      ? { reply: result.value.reply, ok: true }
      : // The sentence resolved and the command failed. Saying so beats an
        // empty screen that looks like it worked.
        { reply: "That could not be done. Nothing changed.", ok: false };
  };
  return { resolve, run };
}
