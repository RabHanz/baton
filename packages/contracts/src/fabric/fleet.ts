/**
 * The fleet: one answer to "what is everything doing?".
 *
 * §29 Phase 4's exit criterion is a list of five questions — what is running,
 * where, under which account, what needs the user, what recently completed —
 * and this shape exists to answer all five in one read, so a client does not
 * open every thread to find out.
 *
 * Each entry is a work session, not a thread, because that is the unit the
 * user thinks in. The thread detail underneath it is what makes "under which
 * account" answerable.
 *
 * @module fabric/fleet
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { IsoDateTime, ProjectId, ThreadId, TrimmedNonEmptyString } from "../baseSchemas.ts";
import { ProviderDriverKind, ProviderInstanceId } from "../providerInstance.ts";
import { FabricSessionState } from "./sessionState.ts";
import { WorkSessionSynopsis } from "./synopsis.ts";
import { WorkSessionId, WorkSessionStatus } from "./workSession.ts";

/** One live provider thread under a work session, with its derived state. */
export const FabricFleetThread = Schema.Struct({
  threadId: ThreadId,
  title: TrimmedNonEmptyString,
  state: FabricSessionState,
  providerInstanceId: Schema.NullOr(ProviderInstanceId),
  providerDriver: Schema.NullOr(ProviderDriverKind),
  /** The thread's checkout, for the "which branch" question. */
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  /** When the provider last did anything, for ordering and staleness. */
  lastActivityAt: Schema.NullOr(IsoDateTime),
});
export type FabricFleetThread = typeof FabricFleetThread.Type;

/**
 * One adopted session under a work session. Thin on purpose: the fleet needs
 * to say it exists, what it is doing, and that it is not one of ours.
 */
export const FabricFleetAdopted = Schema.Struct({
  id: TrimmedNonEmptyString,
  runtime: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  state: FabricSessionState,
  /** True when Fabric may type into it — §9's declared capability, on the row. */
  canSendInput: Schema.Boolean,
});
export type FabricFleetAdopted = typeof FabricFleetAdopted.Type;

export const FabricFleetEntry = Schema.Struct({
  workSessionId: WorkSessionId,
  title: TrimmedNonEmptyString,
  projectId: ProjectId,
  /** The work session's lifecycle, which is not the same as its activity. */
  lifecycle: WorkSessionStatus,
  /** The most demanding state among its live threads. */
  state: FabricSessionState,
  needsUser: Schema.Boolean,
  activeThreadId: Schema.NullOr(ThreadId),
  threads: Schema.Array(FabricFleetThread),
  /**
   * Sessions Fabric adopted rather than started (§9): a Herdr pane, a terminal
   * somebody else opened. They carry a state like any other row and a declared
   * set of things Fabric cannot do to them.
   *
   * Optional with a default so a client from before Phase 8 decodes an entry
   * that has them, and a server from before Phase 8 decodes into a client that
   * expects them.
   */
  adopted: Schema.Array(FabricFleetAdopted).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  synopsis: Schema.NullOr(WorkSessionSynopsis),
  updatedAt: IsoDateTime,
});
export type FabricFleetEntry = typeof FabricFleetEntry.Type;

export const FabricFleet = Schema.Struct({
  entries: Schema.Array(FabricFleetEntry),
  /** When the environment computed this. Every entry is as of this instant. */
  observedAt: IsoDateTime,
});
export type FabricFleet = typeof FabricFleet.Type;

export const FabricFleetInput = Schema.Struct({
  /** Archived work is out of the fleet by default, as it is out of the list. */
  includeArchived: Schema.optionalKey(Schema.Boolean),
  /** Only work that cannot move without the user. The §33 top-level filter. */
  needsUserOnly: Schema.optionalKey(Schema.Boolean),
});
export type FabricFleetInput = typeof FabricFleetInput.Type;

export const FabricFleetResult = Schema.Struct({ fleet: FabricFleet });
export type FabricFleetResult = typeof FabricFleetResult.Type;

/**
 * Ordering for a fleet list. What needs the user first, then what is running,
 * then what finished unseen, then the rest; recency breaks ties so a list that
 * is all one state still reads newest-first.
 */
export const compareFleetEntries = (
  left: Pick<FabricFleetEntry, "state" | "updatedAt">,
  right: Pick<FabricFleetEntry, "state" | "updatedAt">,
  priority: Readonly<Record<FabricSessionState, number>>,
): number => {
  const byState = priority[left.state] - priority[right.state];
  if (byState !== 0) return byState;
  return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
};

/** The §11 staleness disclosure, as a wire field rather than a client guess. */
export const FabricFleetSummary = Schema.Struct({
  working: Schema.Int.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
  needsUser: Schema.Int.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
  doneUnseen: Schema.Int.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
  idle: Schema.Int.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
  offline: Schema.Int.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
});
export type FabricFleetSummary = typeof FabricFleetSummary.Type;

export const summariseFleet = (
  entries: ReadonlyArray<Pick<FabricFleetEntry, "state" | "needsUser">>,
): FabricFleetSummary => ({
  working: entries.filter(
    (entry) =>
      entry.state === "working" || entry.state === "starting" || entry.state === "monitoring",
  ).length,
  needsUser: entries.filter((entry) => entry.needsUser).length,
  doneUnseen: entries.filter((entry) => entry.state === "done_unseen").length,
  idle: entries.filter((entry) => entry.state === "idle").length,
  offline: entries.filter((entry) => entry.state === "offline").length,
});
