/* oxlint-disable t3code/no-low-value-comments -- Baton file predating upstream's rule (D82) */
/**
 * Baton work sessions, client side.
 *
 * The server streams a snapshot followed by events. This module folds that into
 * the list a client renders, and exposes the mutations as commands. It lives in
 * `client-runtime` so web and mobile share one reducer — a second copy would
 * drift, and the shell/thread state is shared here for exactly that reason.
 *
 * Deliberately absent: anything about a thread's current state. Which account
 * is running, whether it is working or waiting, what it last said — all of that
 * is thread state the client already streams. Joining the two is presentation,
 * and it belongs in the surface that renders it.
 */
import {
  BATON_ACCOUNT_WS_METHODS,
  BATON_INTENT_WS_METHODS,
  BATON_ORCHESTRATION_WS_METHODS,
  BATON_HANDOFF_WS_METHODS,
  BATON_LIVE_WS_METHODS,
  BATON_WS_METHODS,
  BatonFleetResult,
  type WorkSession,
  type WorkSessionStreamItem,
} from "@t3tools/baton-contracts";
import { Atom } from "effect/reactivity";
import * as Stream from "effect/Stream";
import { persistQuery } from "@t3tools/client-runtime/state/query-persistence";

import type { EnvironmentRegistry as EnvironmentRegistryModule } from "@t3tools/client-runtime/connection";

type EnvironmentRegistry = EnvironmentRegistryModule.EnvironmentRegistry;
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "@t3tools/client-runtime/state/runtime";

/**
 * Apply one stream item to the list a client is holding.
 *
 * An archived work session leaves the list, because the subscription mirrors
 * the default `list` view, which hides archived work. Unarchiving brings it
 * back — the event carries the whole record, so no refetch is needed either
 * way.
 *
 * Upserts move to the front. Every server-side mutation stamps `updatedAt`, and
 * the server orders by it descending, so this keeps a live list in the same
 * order as a fresh read.
 */
export const applyWorkSessionStreamItem = (
  current: ReadonlyArray<WorkSession>,
  item: WorkSessionStreamItem,
): ReadonlyArray<WorkSession> => {
  if (item.kind === "snapshot") return item.workSessions;
  // A synopsis update touches one field of a record already in the list, and
  // must not reorder it: the synopsis moves far more often than the work does,
  // and letting it reshuffle the list would make it unreadable while anything
  // is running.
  if (item.kind === "fabric.synopsis.updated") {
    return current.map((existing) =>
      existing.id === item.workSessionId ? { ...existing, synopsis: item.synopsis } : existing,
    );
  }
  const { workSession } = item;
  const without = current.filter((existing) => existing.id !== workSession.id);
  return workSession.archivedAt !== null ? without : [workSession, ...without];
};

export function createBatonWorkSessionAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const scheduler = createAtomCommandScheduler();
  // Work-session mutations are read-modify-write on the server. Sending two at
  // once from one client would have them queue there anyway; serializing per
  // environment keeps the client's optimistic ordering honest.
  const concurrency = {
    mode: "serial" as const,
    key: ({ environmentId }: { environmentId: string }) => environmentId,
  };
  /** The environment's work sessions, folded from snapshot plus events. */
  const workSessions = createEnvironmentRpcSubscriptionAtomFamily(runtime, {
    label: "environment-data:baton:work-sessions",
    tag: BATON_WS_METHODS.subscribeWorkSessions,
    transform: (stream) =>
      Stream.scan(stream, (): ReadonlyArray<WorkSession> => [], applyWorkSessionStreamItem),
  });
  return {
    workSessions,
    /**
     * The fleet as a query: it waits for the environment's connection instead of failing before
     * it (the old read-on-mount did, and the next try was a 20 s tick, which was the "first
     * sidebar load"); the last answer is persisted, so a reload paints at once; it re-reads when
     * a work session moves, and every 15 s for Herdr and Claude sessions, which nothing streams.
     */
    fleetQuery: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:baton:fleet-query",
      tag: BATON_WS_METHODS.fleetGet,
      persistence: persistQuery(BatonFleetResult),
      staleTimeMs: 5_000,
      refreshIntervalMs: 15_000,
      refreshTrigger: ({ environmentId }) => workSessions({ environmentId, input: {} }),
    }),
    list: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:baton:work-session-list",
      tag: BATON_WS_METHODS.workSessionList,
    }),
    /**
     * The environment's own fleet. Read from the server rather than derived
     * locally so every surface — web, mobile, and a later phase's spoken
     * answers — gets the same states from the same rules. Refreshed on the
     * work-session stream rather than on a timer: a polled fleet is wrong
     * between polls and expensive while it is right.
     */
    fleet: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:baton:fleet",
      tag: BATON_WS_METHODS.fleetGet,
    }),
    /** Rules and their firings, so a rule is inspectable rather than ambient (§22). */
    rules: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:baton:rules",
      tag: BATON_ORCHESTRATION_WS_METHODS.ruleList,
    }),
    /**
     * One sentence, resolved and not run. This is what the input calls while
     * the user is still typing, so it must never write anything — which is why
     * it is a separate method with a read scope rather than a flag on `run`.
     */
    intentResolve: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:baton:intent-resolve",
      tag: BATON_INTENT_WS_METHODS.intentResolve,
    }),
    intentRun: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:baton:intent-run",
      tag: BATON_INTENT_WS_METHODS.intentRun,
      scheduler,
      concurrency,
    }),
    intents: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:baton:intent-list",
      tag: BATON_INTENT_WS_METHODS.intentList,
    }),
    ruleCreate: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:baton:rule-create",
      tag: BATON_ORCHESTRATION_WS_METHODS.ruleCreate,
      scheduler,
      concurrency,
    }),
    ruleDisable: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:baton:rule-disable",
      tag: BATON_ORCHESTRATION_WS_METHODS.ruleDisable,
      scheduler,
      concurrency,
    }),
    ruleEnable: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:baton:rule-enable",
      tag: BATON_ORCHESTRATION_WS_METHODS.ruleEnable,
      scheduler,
      concurrency,
    }),
    ruleConfirm: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:baton:rule-confirm",
      tag: BATON_ORCHESTRATION_WS_METHODS.ruleConfirm,
      scheduler,
      concurrency,
    }),
    create: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:baton:work-session-create",
      tag: BATON_WS_METHODS.workSessionCreate,
      scheduler,
      concurrency,
    }),
    update: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:baton:work-session-update",
      tag: BATON_WS_METHODS.workSessionUpdate,
      scheduler,
      concurrency,
    }),
    attachThread: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:baton:work-session-attach-thread",
      tag: BATON_WS_METHODS.workSessionAttachThread,
      scheduler,
      concurrency,
    }),
    detachThread: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:baton:work-session-detach-thread",
      tag: BATON_WS_METHODS.workSessionDetachThread,
      scheduler,
      concurrency,
    }),
    startThread: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:baton:work-session-start-thread",
      tag: BATON_WS_METHODS.workSessionStartThread,
      scheduler,
      concurrency,
    }),
    liveAttach: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:baton:live-attach",
      tag: BATON_LIVE_WS_METHODS.liveAttach,
      scheduler,
      concurrency,
    }),
    liveAdopt: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:baton:live-adopt",
      tag: BATON_LIVE_WS_METHODS.liveAdopt,
      scheduler,
      concurrency,
    }),
    herdrSend: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:baton:herdr-send",
      tag: BATON_LIVE_WS_METHODS.herdrSend,
      scheduler,
      concurrency,
    }),
    accountPoolQuery: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:baton:account-pool-query",
      tag: BATON_ACCOUNT_WS_METHODS.accountPool,
      staleTimeMs: 30_000,
      refreshIntervalMs: 60_000,
    }),
    accountUse: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:baton:account-use",
      tag: BATON_ACCOUNT_WS_METHODS.accountUse,
      scheduler,
      concurrency,
    }),
    threadAccountUse: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:baton:thread-account-use",
      tag: BATON_ACCOUNT_WS_METHODS.threadAccountUse,
      scheduler,
      concurrency,
    }),
    handoff: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:baton:work-session-handoff",
      tag: BATON_HANDOFF_WS_METHODS.workSessionHandoff,
      scheduler,
      concurrency,
    }),
    settle: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:baton:work-session-settle",
      tag: BATON_WS_METHODS.workSessionSettle,
      scheduler,
      concurrency,
    }),
    unsettle: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:baton:work-session-unsettle",
      tag: BATON_WS_METHODS.workSessionUnsettle,
      scheduler,
      concurrency,
    }),
    archive: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:baton:work-session-archive",
      tag: BATON_WS_METHODS.workSessionArchive,
      scheduler,
      concurrency,
    }),
    unarchive: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:baton:work-session-unarchive",
      tag: BATON_WS_METHODS.workSessionUnarchive,
      scheduler,
      concurrency,
    }),
  };
}
