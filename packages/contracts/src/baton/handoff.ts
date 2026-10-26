/**
 * §6.1 handoff: continue the same work on another provider instance.
 *
 * In-place account rotation (`fabric.account.use`, D56/D57) covers accounts
 * behind one Claude config directory. Everything else — Claude to Codex, a
 * second config directory, another driver — cannot continue the provider's own
 * conversation, so the work moves with a capsule: a minimal but sufficient
 * statement of where the work is, built from the work session and the
 * checkout, never from a transcript dump. The old thread stays attached as
 * history; the new one becomes active in the same worktree.
 *
 * @module baton/handoff
 */
import * as Schema from "effect/Schema";

import { ThreadId, TrimmedNonEmptyString, TrimmedString } from "../baseSchemas.ts";
import { ModelSelection, RuntimeMode } from "../orchestration.ts";
import { WorkSession, WorkSessionId } from "./workSession.ts";

// Legacy names (D71): wire method names keep "fabric." so installed clients keep working.
export const BATON_HANDOFF_WS_METHODS = {
  workSessionHandoff: "fabric.workSession.handoff",
} as const;

export const HandoffGitCheckpoint = Schema.Struct({
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktree: Schema.NullOr(TrimmedNonEmptyString),
  commit: Schema.NullOr(TrimmedNonEmptyString),
  dirtyFiles: Schema.Array(TrimmedNonEmptyString),
});
export type HandoffGitCheckpoint = typeof HandoffGitCheckpoint.Type;

/** The §6.1 capsule, structured. `text` is the rendering the new thread receives. */
export const HandoffCapsule = Schema.Struct({
  objective: TrimmedString,
  currentState: Schema.NullOr(TrimmedNonEmptyString),
  latestHumanDirection: Schema.NullOr(TrimmedNonEmptyString),
  knownFindings: Schema.Array(TrimmedNonEmptyString),
  unresolvedQuestions: Schema.Array(TrimmedNonEmptyString),
  filesChanged: Schema.Array(TrimmedNonEmptyString),
  validationResults: Schema.Array(TrimmedNonEmptyString),
  git: HandoffGitCheckpoint,
  constraints: Schema.Array(TrimmedNonEmptyString),
  acceptanceCriteria: Schema.Array(TrimmedNonEmptyString),
  recommendedNextAction: Schema.NullOr(TrimmedNonEmptyString),
  sourceThreadId: Schema.NullOr(ThreadId),
  sourceProvider: Schema.NullOr(TrimmedNonEmptyString),
  text: TrimmedNonEmptyString,
});
export type HandoffCapsule = typeof HandoffCapsule.Type;

export const WorkSessionHandoffInput = Schema.Struct({
  id: WorkSessionId,
  /** Caller-supplied, like every thread id: a retried handoff is the same handoff. */
  threadId: ThreadId,
  modelSelection: ModelSelection,
  runtimeMode: Schema.optionalKey(RuntimeMode),
  /** What the user said when asking for the move, if anything. */
  note: Schema.optionalKey(TrimmedString),
});
export type WorkSessionHandoffInput = typeof WorkSessionHandoffInput.Type;

export const WorkSessionHandoffResult = Schema.Struct({
  workSession: WorkSession,
  capsule: HandoffCapsule,
});
export type WorkSessionHandoffResult = typeof WorkSessionHandoffResult.Type;

export class WorkSessionHandoffRefusedError extends Schema.TaggedError<WorkSessionHandoffRefusedError>()(
  "WorkSessionHandoffRefusedError",
  { workSessionId: WorkSessionId, reason: Schema.String },
) {
  override get message(): string {
    return `Work session ${this.workSessionId} was not handed off: ${this.reason}`;
  }
}

const bullets = (title: string, items: ReadonlyArray<string>): Array<string> =>
  items.length === 0 ? [] : [`${title}:`, ...items.map((item) => `- ${item}`), ""];

/**
 * Build the capsule from what Baton already knows. Pure, so the exact text a
 * provider receives is testable. Deliberately small: the synopsis is already
 * capped (§11), and older context stays in the source thread for the new
 * provider to ask about.
 */
export const buildHandoffCapsule = (input: {
  readonly workSession: WorkSession;
  readonly git: HandoffGitCheckpoint;
  readonly sourceThreadId: string | null;
  readonly sourceProvider: string | null;
  readonly note: string | null;
}): HandoffCapsule => {
  const { workSession, git } = input;
  const synopsis = workSession.synopsis ?? null;
  const objective = workSession.objective || synopsis?.goal || workSession.title;
  const knownFindings = (synopsis?.recentFindings ?? []).map((finding) => finding.text);
  const unresolvedQuestions = synopsis?.needsUser
    ? [synopsis.currentAction ?? "The previous session was waiting on the user."]
    : [];
  const validationResults = (synopsis?.validation ?? []).map(
    (entry) => `${entry.label}: ${entry.outcome}`,
  );
  const recommendedNextAction = synopsis?.next[0] ?? null;
  const note = input.note !== null && input.note.trim().length > 0 ? input.note.trim() : null;

  const text = [
    `You are continuing work that was started by ${input.sourceProvider ?? "another session"}.`,
    `It is the same piece of work, in the same checkout; do not start over.`,
    "",
    `Work: ${workSession.title}`,
    `Objective: ${objective}`,
    ...(synopsis?.currentAction ? [`Where it was: ${synopsis.currentAction}`] : []),
    ...(note === null ? [] : [`Latest direction from the user: ${note}`]),
    "",
    ...bullets("Findings so far", knownFindings),
    ...bullets("Open questions", unresolvedQuestions),
    ...bullets("Files changed", synopsis?.changedFiles ?? []),
    ...bullets("Validation", validationResults),
    ...bullets("Constraints", workSession.constraints),
    ...bullets("Acceptance criteria", workSession.acceptanceCriteria),
    "Git checkpoint:",
    `- branch: ${git.branch ?? "unknown"}`,
    `- worktree: ${git.worktree ?? "unknown"}`,
    `- commit: ${git.commit ?? "unknown"}`,
    `- uncommitted files: ${git.dirtyFiles.length === 0 ? "none" : git.dirtyFiles.join(", ")}`,
    "",
    recommendedNextAction === null
      ? "Start by checking the git state above against the objective, then continue."
      : `Recommended next action: ${recommendedNextAction}`,
    ...(input.sourceThreadId === null
      ? []
      : ["", `Earlier history lives in thread ${input.sourceThreadId}; ask if you need it.`]),
  ].join("\n");

  return {
    objective,
    currentState: synopsis?.currentAction ?? null,
    latestHumanDirection: note,
    knownFindings,
    unresolvedQuestions,
    filesChanged: [...(synopsis?.changedFiles ?? [])],
    validationResults,
    git,
    constraints: [...workSession.constraints],
    acceptanceCriteria: [...workSession.acceptanceCriteria],
    recommendedNextAction,
    sourceThreadId: input.sourceThreadId === null ? null : ThreadId.make(input.sourceThreadId),
    sourceProvider: input.sourceProvider,
    text,
  };
};
