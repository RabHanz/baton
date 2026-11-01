/**
 * Jobs (D145): long work handed to a worker thread, with written permissions. A job is a work
 * session plus its terms. Status is never stored: it is read from the work session's state.
 */
import * as Schema from "effect/Schema";

import { IsoDateTime, TrimmedNonEmptyString, TrimmedString } from "@t3tools/contracts";

import { BatonSessionState } from "./sessionState.ts";
import { WorkSessionId } from "./workSession.ts";

export const JOB_GROUPS = ["running", "needs_you", "done", "failed"] as const;
export const BatonJobGroup = Schema.Literals(JOB_GROUPS);
export type BatonJobGroup = typeof BatonJobGroup.Type;

/** What a worker thread may touch, in the terms he reads on the card. */
export const BatonJobTool = Schema.Literals(["read", "edit", "shell", "web", "sessions"]);
export type BatonJobTool = typeof BatonJobTool.Type;

/** Where a message could go. Every one of these is public, and none is done without his yes. */
export const BatonOutboundChannel = Schema.Literals(["email", "social", "chat", "pr_comment", "other_public"]);
export type BatonOutboundChannel = typeof BatonOutboundChannel.Type;

export const BatonJobPermissions = Schema.Struct({
  /** Folders the worker may read and change. */
  folders: Schema.Array(TrimmedNonEmptyString),
  /** Projects it may work in, by their names. */
  projects: Schema.Array(TrimmedNonEmptyString),
  tools: Schema.Array(BatonJobTool),
});
export type BatonJobPermissions = typeof BatonJobPermissions.Type;

/** Both caps apply to a subscription; dollars only to a metered API key, which is never set up by default. */
export const BatonJobLimits = Schema.Struct({
  wallClockMinutes: Schema.Number,
  workerTurns: Schema.Number,
  dollars: Schema.NullOr(Schema.Number),
});
export type BatonJobLimits = typeof BatonJobLimits.Type;

export const DEFAULT_JOB_LIMITS: BatonJobLimits = { wallClockMinutes: 120, workerTurns: 40, dollars: null };

/** What a standing permission is for: sending on a channel, or starting without waiting for his OK. */
export const BatonGrantKind = Schema.Literals([
  "email",
  "social",
  "chat",
  "pr_comment",
  "other_public",
  "start",
]);
export type BatonGrantKind = typeof BatonGrantKind.Type;

/** A standing permission, for one job. Kept after it is revoked, as the log. */
export const BatonJobGrant = Schema.Struct({
  channel: BatonGrantKind,
  grantedAt: IsoDateTime,
  revokedAt: Schema.NullOr(IsoDateTime),
});
export type BatonJobGrant = typeof BatonJobGrant.Type;

/** Where a job is before work starts (D145): planning, waiting for his OK, or approved to run. */
export const BatonJobPhase = Schema.Literals(["drafting_plan", "awaiting_agreement", "approved"]);
export type BatonJobPhase = typeof BatonJobPhase.Type;

/** Every word he or Baton added to the job's context after it began: who said what, when, and how. */
export const BatonJobRevision = Schema.Struct({
  by: Schema.Literals(["him", "baton"]),
  at: IsoDateTime,
  via: Schema.Literals(["voice", "text", "thread"]),
  text: TrimmedNonEmptyString,
});
export type BatonJobRevision = typeof BatonJobRevision.Type;

export const BatonJobTerms = Schema.Struct({
  workSessionId: WorkSessionId,
  goal: TrimmedString,
  permissions: BatonJobPermissions,
  limits: BatonJobLimits,
  grants: Schema.Array(BatonJobGrant),
  phase: BatonJobPhase,
  revisions: Schema.Array(BatonJobRevision),
  /** T3's own scheduled task that starts or resumes the worker; null for a job that runs once. */
  scheduleTaskId: Schema.NullOr(TrimmedNonEmptyString),
  /** The provider instance the worker runs on, chosen from the pool unless he said. */
  workerInstanceId: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type BatonJobTerms = typeof BatonJobTerms.Type;

/** What a job card shows. */
export const BatonJob = Schema.Struct({
  workSessionId: WorkSessionId,
  title: TrimmedNonEmptyString,
  goal: TrimmedString,
  group: BatonJobGroup,
  state: BatonSessionState,
  lastActivityAt: IsoDateTime,
  /** The permissions in words, as written on the card. */
  permissionsSummary: TrimmedNonEmptyString,
  /** "time", "turns" or "spend" when a cap has been reached; null while it is within them. */
  phase: BatonJobPhase,
  limitReached: Schema.NullOr(Schema.Literals(["time", "turns", "spend"])),
  terms: BatonJobTerms,
});
export type BatonJob = typeof BatonJob.Type;
