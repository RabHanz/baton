/**
 * Everything that waits for his yes, in one list (D146): a job's plan that wants his OK, and a
 * session that has asked him something. Each says the action, what it belongs to and the permission it
 * would use. Pure; the window and the assistant both read it.
 */
import type { BatonJob, BatonSessionSummary } from "@t3tools/baton-contracts";

export interface Approval {
  readonly id: string;
  readonly kind: "plan" | "session";
  readonly title: string;
  /** The exact thing his yes would allow. */
  readonly action: string;
  /** What it would be allowed to use. */
  readonly permission: string;
  /** The job's id for a plan, the session's key for a session. */
  readonly ref: string;
}

export const buildApprovals = (input: {
  readonly jobs: ReadonlyArray<BatonJob>;
  readonly sessions: ReadonlyArray<BatonSessionSummary>;
}): ReadonlyArray<Approval> => [
  ...input.jobs
    .filter((j) => j.phase === "awaiting_agreement")
    .map((j): Approval => ({
      id: `p:${j.workSessionId}`,
      kind: "plan",
      title: j.title,
      action: "Start the work as planned",
      permission: j.permissionsSummary,
      ref: j.workSessionId,
    })),
  ...input.sessions
    .filter((s) => s.urgent)
    .map((s): Approval => ({
      id: `s:${s.key}`,
      kind: "session",
      title: s.session,
      action: `Answer its question in ${s.project} on ${s.box}`,
      permission: "Whatever the session asked for, shown in its thread",
      ref: s.key,
    })),
];

/** Plain sentences for the assistant, with the ids it needs to act. */
export const describeApprovals = (items: ReadonlyArray<Approval>): string =>
  items.length === 0
    ? "Nothing is waiting for his yes."
    : items
        .map(
          (a) =>
            `${a.title}: ${a.action}. Would use: ${a.permission}. ${a.kind === "plan" ? `Approve with job_agree, decline with job_stop` : "Only he can answer it, in its thread"} [id: ${a.ref}]`,
        )
        .join("\n");
