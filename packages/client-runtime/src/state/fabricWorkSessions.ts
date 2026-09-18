/**
 * Fabric work sessions, client side.
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
  FABRIC_ORCHESTRATION_WS_METHODS,
  FABRIC_WS_METHODS,
  type WorkSession,
  type WorkSessionStreamItem,
} from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";
import * as Stream from "effect/Stream";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

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

export function createFabricWorkSessionAtoms<R, E>(
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
  return {
    /** The environment's work sessions, folded from snapshot plus events. */
    workSessions: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:fabric:work-sessions",
      tag: FABRIC_WS_METHODS.subscribeWorkSessions,
      transform: (stream) =>
        Stream.scan(stream, [] as ReadonlyArray<WorkSession>, applyWorkSessionStreamItem),
    }),
    list: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:fabric:work-session-list",
      tag: FABRIC_WS_METHODS.workSessionList,
    }),
    /**
     * The environment's own fleet. Read from the server rather than derived
     * locally so every surface — web, mobile, and a later phase's spoken
     * answers — gets the same states from the same rules. Refreshed on the
     * work-session stream rather than on a timer: a polled fleet is wrong
     * between polls and expensive while it is right.
     */
    fleet: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:fabric:fleet",
      tag: FABRIC_WS_METHODS.fleetGet,
    }),
    /** Rules and their firings, so a rule is inspectable rather than ambient (§22). */
    rules: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:fabric:rules",
      tag: FABRIC_ORCHESTRATION_WS_METHODS.ruleList,
    }),
    ruleCreate: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:fabric:rule-create",
      tag: FABRIC_ORCHESTRATION_WS_METHODS.ruleCreate,
      scheduler,
      concurrency,
    }),
    ruleDisable: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:fabric:rule-disable",
      tag: FABRIC_ORCHESTRATION_WS_METHODS.ruleDisable,
      scheduler,
      concurrency,
    }),
    ruleEnable: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:fabric:rule-enable",
      tag: FABRIC_ORCHESTRATION_WS_METHODS.ruleEnable,
      scheduler,
      concurrency,
    }),
    ruleConfirm: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:fabric:rule-confirm",
      tag: FABRIC_ORCHESTRATION_WS_METHODS.ruleConfirm,
      scheduler,
      concurrency,
    }),
    create: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:fabric:work-session-create",
      tag: FABRIC_WS_METHODS.workSessionCreate,
      scheduler,
      concurrency,
    }),
    update: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:fabric:work-session-update",
      tag: FABRIC_WS_METHODS.workSessionUpdate,
      scheduler,
      concurrency,
    }),
    attachThread: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:fabric:work-session-attach-thread",
      tag: FABRIC_WS_METHODS.workSessionAttachThread,
      scheduler,
      concurrency,
    }),
    detachThread: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:fabric:work-session-detach-thread",
      tag: FABRIC_WS_METHODS.workSessionDetachThread,
      scheduler,
      concurrency,
    }),
    startThread: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:fabric:work-session-start-thread",
      tag: FABRIC_WS_METHODS.workSessionStartThread,
      scheduler,
      concurrency,
    }),
    settle: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:fabric:work-session-settle",
      tag: FABRIC_WS_METHODS.workSessionSettle,
      scheduler,
      concurrency,
    }),
    unsettle: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:fabric:work-session-unsettle",
      tag: FABRIC_WS_METHODS.workSessionUnsettle,
      scheduler,
      concurrency,
    }),
    archive: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:fabric:work-session-archive",
      tag: FABRIC_WS_METHODS.workSessionArchive,
      scheduler,
      concurrency,
    }),
    unarchive: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:fabric:work-session-unarchive",
      tag: FABRIC_WS_METHODS.workSessionUnarchive,
      scheduler,
      concurrency,
    }),
  };
}
