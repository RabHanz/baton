// @effect-diagnostics nodeBuiltinImport:off
/**
 * The job's flow from his words to work (D145): the worker thread is made in plan mode with his
 * words verbatim, and only his agreement (or a standing "start" grant at plan time) lets it work.
 * The RPC handlers, the desktop tools and the phone all call these; none holds the flow itself.
 */
import {
  type BatonJobRefineInput,
  type BatonFleetEntry,
  type BatonJobScheduleInput,
  type BatonJobSplitInput,
  type BatonJobStartInput,
  WorkSessionId,
} from "@t3tools/baton-contracts";
import {
  partsSettled,
  partsSummary,
  MAX_PARTS,
  SUMMARY_MARK,
} from "@t3tools/baton-shared/coordinator";
import { BLOCKED_MARK } from "@t3tools/baton-shared/coordinator";
import { briefNudge, NUDGE_MARK, parseJobBrief } from "@t3tools/baton-shared/jobBrief";
import { permissionsSummary, workerFirstMessage } from "@t3tools/baton-shared/jobs";
import { watchFleet } from "@t3tools/baton-shared/watch";
import { type ThreadId, ThreadId as ThreadIdSchema } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Random from "effect/Random";

import type { ScheduledTaskId } from "@t3tools/contracts";
import { ScheduledTaskService } from "../scheduledTasks/ScheduledTaskService.ts";
import * as NodePath from "node:path";

import * as ServerConfig from "../config.ts";
import { BatonEngine } from "./BatonEngine.ts";
import { planningFrame, readPack, readRouting } from "./OperatingSystemPack.ts";
import { modelFor } from "@t3tools/baton-shared/costRouting";
import { BatonJobService } from "./BatonJobService.ts";
import * as FleetQuery from "./FleetQuery.ts";
import { WorkSessionService } from "./WorkSessionService.ts";

const threadOf = Effect.fn("BatonJobFlow.threadOf")(function* (id: WorkSessionId) {
  const workSession = yield* (yield* WorkSessionService).get(id);
  return (
    workSession.providerSessions.find((session) => session.detachedAt === null)?.threadId ?? null
  );
});

/** The planning frame, with the brief of the specialist a part is given to. */
const frame = (userdata: string, role: string | undefined): string => {
  const base = planningFrame(userdata);
  const brief = role === undefined ? undefined : readPack(userdata).roles[role];
  return brief === undefined ? base : `${base}\n\nYour role (${role}): ${brief}`;
};

export interface StartOptions {
  /** This job is a part of another (the coordinator, D148). */
  readonly parentId?: WorkSessionId;
  /** Already agreed as part of the parent's plan: no planning pause, and it works at once. */
  readonly agreed?: boolean;
  /** A specialist role of the pack, whose brief is put in the frame. */
  readonly role?: string;
}

export const startJob = Effect.fn("BatonJobFlow.start")(function* (
  input: BatonJobStartInput,
  options: StartOptions = {},
) {
  const jobs = yield* BatonJobService;
  const engine = yield* BatonEngine;
  const workSessions = yield* WorkSessionService;
  const uuid = Effect.gen(function* () {
    const ms = yield* Clock.currentTimeMillis;
    const noise = yield* Random.nextIntBetween(0, 2 ** 31 - 1);
    return `${ms.toString(36)}-${noise.toString(36)}`;
  });
  const id = input.id ?? WorkSessionId.make(`job-${yield* uuid}`);
  const terms = yield* jobs.create({
    id,
    projectId: input.projectId,
    title: input.title,
    goal: input.goal,
    permissions: input.permissions,
    ...(input.limits === undefined ? {} : { limits: input.limits }),
    workerInstanceId: input.modelSelection.instanceId,
    ...(options.parentId === undefined ? {} : { parentId: options.parentId }),
  });
  // A retried start finds the thread it already made.
  const existing = yield* threadOf(id);
  if (existing !== null) return { terms, threadId: existing, model: input.modelSelection.model };
  const workSession = yield* workSessions.get(id);
  const threadId = ThreadIdSchema.make(`job-thread-${yield* uuid}`);
  const launched = yield* engine.launchThread({
    tag: "job",
    threadId,
    projectId: input.projectId,
    title: input.title,
    modelSelection: input.modelSelection,
    runtimeMode: input.runtimeMode,
    interactionMode: options.agreed === true ? "default" : "plan",
    worktreePath: workSession.primaryWorktreePath,
    branch: workSession.baseBranch,
    text: workerFirstMessage({
      verbatim: input.goal,
      frame: frame(NodePath.dirname((yield* ServerConfig.ServerConfig).dbPath), options.role),
      ...(options.agreed === true ? { agreed: true } : {}),
      permissionsSummary: permissionsSummary(terms.permissions, terms.limits, terms.grants),
    }),
  });
  if (launched === null) {
    return yield* Effect.die(new Error("The worker thread could not be started."));
  }
  yield* workSessions.attachThread({
    id,
    threadId: launched,
    providerInstanceId: input.modelSelection.instanceId,
    providerDriver: null,
    origin: "created",
  });
  if (options.agreed === true) {
    yield* jobs.planReady(id);
    return {
      terms: (yield* jobs.agree(id)) ?? terms,
      threadId: launched,
      model: input.modelSelection.model,
    };
  }
  return { terms, threadId: launched, model: input.modelSelection.model };
});

/** The plan stands and the work begins: out of plan mode, and told to go. */
export const beginWork = Effect.fn("BatonJobFlow.beginWork")(function* (threadId: ThreadId) {
  const engine = yield* BatonEngine;
  yield* engine
    .setInteractionMode({ tag: "job", threadId, interactionMode: "default" })
    .pipe(Effect.ignoreCause({ log: true }));
  yield* engine.sendMessage({
    tag: "job",
    threadId,
    text: "Go ahead with the plan as it stands. Stay inside what you were allowed.",
  });
});

export const agreeJob = Effect.fn("BatonJobFlow.agree")(function* (id: WorkSessionId) {
  const jobs = yield* BatonJobService;
  let before = yield* jobs.terms(id);
  if (before === null) return null;
  // The worker's planning turn has ended, so the plan is in the thread: a reply there, a click or
  // a spoken yes is an answer to it. (A reactor will notice this by itself in a later step.)
  if (before.phase === "drafting_plan") {
    const threadId = yield* threadOf(id);
    const shell = threadId === null ? null : yield* (yield* BatonEngine).threadShell(threadId);
    if (shell?.status === "completed") before = (yield* jobs.planReady(id)) ?? before;
  }
  const terms = yield* jobs.agree(id);
  // Only a job that was waiting starts; agreeing twice sends nothing twice.
  if (terms !== null && before.phase === "awaiting_agreement" && terms.phase === "approved") {
    const threadId = yield* threadOf(id);
    if (threadId !== null) yield* beginWork(threadId);
  }
  return terms;
});

export const refineJob = Effect.fn("BatonJobFlow.refine")(function* (input: BatonJobRefineInput) {
  const jobs = yield* BatonJobService;
  const at = DateTime.formatIso(DateTime.makeUnsafe(yield* Clock.currentTimeMillis));
  const terms = yield* jobs.refine(
    input.id,
    { by: "him", at, via: input.via, text: input.text },
    input.widens === true,
  );
  if (terms === null) return null;
  const threadId = yield* threadOf(input.id);
  // The plan is made again with his words, word for word.
  if (threadId !== null) {
    const engine = yield* BatonEngine;
    yield* engine.sendMessage({ tag: "job", threadId, text: input.text });
  }
  return terms;
});

/** Runs that actually ran: one is a turn the worker took. Queued, cancelled and rolled-back ones are not. */
const TURN_STATUSES: ReadonlySet<string> = new Set([
  "starting",
  "running",
  "waiting",
  "completed",
  "interrupted",
  "failed",
]);

/** What each worker has taken so far, for the cards and for the caps. */
export const turnCounts = Effect.fn("BatonJobFlow.turnCounts")(function* (
  entries: ReadonlyArray<BatonFleetEntry>,
) {
  const engine = yield* BatonEngine;
  const counts = new Map<string, number>();
  for (const entry of entries) {
    let n = 0;
    for (const thread of entry.threads) {
      const runs = yield* engine.threadRuns(thread.threadId);
      n += runs.filter((r) => TURN_STATUSES.has(r.status)).length;
    }
    counts.set(entry.workSessionId, n);
  }
  return counts;
});

export const listJobs = Effect.fn("BatonJobFlow.list")(function* () {
  const jobs = yield* BatonJobService;
  const fleet = yield* FleetQuery.getFleet({});
  return yield* jobs.view({ entries: fleet.entries, turns: yield* turnCounts(fleet.entries) });
});

/**
 * The caps are enforced, not only shown: an agreed job whose worker is still going after its time or
 * turns are used up is stopped (its thread and plan stay) and a line says why. Raising the cap with a
 * refinement lets it go on. Spend is not measured per job yet, so a dollar cap is never the reason.
 */
export const enforceCaps = Effect.fn("BatonJobFlow.enforceCaps")(function* (
  entries: ReadonlyArray<BatonFleetEntry>,
) {
  const jobs = yield* BatonJobService;
  const cards = yield* jobs.view({ entries, turns: yield* turnCounts(entries) });
  const stopped: string[] = [];
  for (const card of cards) {
    // Only a worker that is going: one waiting for him, or finished, spends nothing.
    if (
      card.phase !== "approved" ||
      card.limitReached === null ||
      !["working", "starting", "monitoring"].includes(card.state)
    ) {
      continue;
    }
    if (!(yield* stopJob(card.workSessionId))) continue;
    const at = DateTime.formatIso(DateTime.makeUnsafe(yield* Clock.currentTimeMillis));
    yield* jobs.refine(card.workSessionId, {
      by: "baton",
      at,
      via: "thread",
      text: `Stopped: it reached its ${card.limitReached} limit. Raise the limit to let it go on.`,
    });
    stopped.push(card.workSessionId);
  }
  return stopped;
});

/**
 * A thread changed: if it is a job's worker that has finished writing its plan, the plan is ready
 * (and a job holding a standing "start" permission begins at once). Anything else changes nothing.
 */
export const noticePlan = Effect.fn("BatonJobFlow.noticePlan")(function* (threadId: ThreadId) {
  const jobs = yield* BatonJobService;
  const id = yield* (yield* WorkSessionService).findForThread(threadId);
  if (id === null) return;
  const terms = yield* jobs.terms(id);
  if (terms === null || terms.phase !== "drafting_plan") return;
  const engine = yield* BatonEngine;
  const shell = yield* engine.threadShell(threadId);
  if (shell?.status !== "completed") return;
  // A plan without the job brief is not ready: ask once, and accept it on the second try so a
  // worker that will not comply cannot hold the job forever.
  const last = (yield* engine.recentMessages(threadId, 1)).findLast((m) => m.role === "assistant");
  const brief = parseJobBrief(last?.text ?? "");
  if (!brief.ok) {
    const asked = terms.revisions.some((r) => r.text.startsWith(NUDGE_MARK));
    if (!asked) {
      const at = DateTime.formatIso(DateTime.makeUnsafe(yield* Clock.currentTimeMillis));
      yield* jobs.refine(id, {
        by: "baton",
        at,
        via: "thread",
        text: `${NUDGE_MARK} ${brief.missing.join(", ")}`,
      });
      yield* engine.sendMessage({ tag: "job", threadId, text: briefNudge(brief.missing) });
      return;
    }
  }
  const next = yield* jobs.planReady(id);
  if (next?.phase === "approved") yield* beginWork(threadId);
});

/** His stop: the worker's running turn ends now. The job and its thread stay for him to read. */
export const stopJob = Effect.fn("BatonJobFlow.stop")(function* (id: WorkSessionId) {
  const threadId = yield* threadOf(id);
  if (threadId === null) return false;
  return yield* (yield* BatonEngine).interruptThread({ tag: "job", threadId });
});

/**
 * A job that has been agreed runs again on a schedule in its own thread, so each run reports where
 * the first one did. Schedules are T3's own scheduled tasks (D145); null takes the schedule off.
 */
export const scheduleJob = Effect.fn("BatonJobFlow.schedule")(function* (
  input: BatonJobScheduleInput,
) {
  const jobs = yield* BatonJobService;
  const tasks = yield* ScheduledTaskService;
  const terms = yield* jobs.terms(input.id);
  if (terms === null) return null;
  if (input.everyMinutes === null) {
    if (terms.scheduleTaskId !== null) {
      yield* tasks
        .delete({ id: terms.scheduleTaskId as ScheduledTaskId })
        .pipe(Effect.ignoreCause({ log: true }));
    }
    return yield* jobs.setSchedule(input.id, null);
  }
  // Recurring work runs unattended, so only a plan he has agreed to is repeated.
  if (terms.phase !== "approved") return terms;
  const threadId = yield* threadOf(input.id);
  const shell = threadId === null ? null : yield* (yield* BatonEngine).threadShell(threadId);
  if (threadId === null || shell === null) return terms;
  const workSession = yield* (yield* WorkSessionService).get(input.id);
  const saved = yield* tasks
    .upsert({
      ...(terms.scheduleTaskId === null ? {} : { id: terms.scheduleTaskId as ScheduledTaskId }),
      title: `${workSession.title} (scheduled)`,
      prompt: `Run this job again and report what changed since the last run.\n\nThe job: ${terms.goal}`,
      enabled: true,
      schedule: {
        type: "interval",
        everyMs: Math.max(60_000, Math.round(input.everyMinutes * 60_000)),
      },
      projectId: shell.projectId,
      threadId,
      workspaceStrategy:
        shell.worktreePath === null
          ? { type: "root" }
          : { type: "existing_worktree", worktreePath: shell.worktreePath },
      modelSelection: shell.modelSelection,
      runtimeMode: "approval-required",
      interactionMode: "default",
    })
    .pipe(Effect.catchTags({ ScheduledTaskError: () => Effect.succeed(null) }));
  return saved === null ? terms : yield* jobs.setSchedule(input.id, saved.task.id);
});

/**
 * Splits an agreed job into parts, each its own worker started already agreed (the parent's plan
 * named them), inside the parent's own permissions. Refused for a plan not yet agreed.
 */
/** Starts one part of an agreed job, already agreed, with its role and model. */
const launchPart = Effect.fn("BatonJobFlow.launchPart")(function* (input: {
  readonly parentId: WorkSessionId;
  readonly id: WorkSessionId;
  readonly title: string;
  readonly goal: string;
  readonly role?: string | undefined;
  readonly routine?: boolean | undefined;
}) {
  const jobs = yield* BatonJobService;
  const parent = yield* jobs.terms(input.parentId);
  const workSession = yield* (yield* WorkSessionService).get(input.parentId);
  const dbPath = (yield* ServerConfig.ServerConfig).dbPath;
  const parentThread = yield* threadOf(input.parentId);
  const shell =
    parentThread === null ? null : yield* (yield* BatonEngine).threadShell(parentThread);
  if (parent === null || shell === null) return null;
  const result = yield* startJob(
    {
      id: input.id,
      projectId: workSession.projectId,
      title: input.title,
      goal: input.goal,
      // A part never has more than its parent: the same folders, projects and tools.
      permissions: parent.permissions,
      // Routine work on the cheap model of his routing table; the rest stays on the parent's.
      modelSelection:
        input.routine === true
          ? {
              ...shell.modelSelection,
              model: modelFor("routine", readRouting(NodePath.dirname(dbPath))),
            }
          : shell.modelSelection,
      runtimeMode: "approval-required",
    },
    {
      parentId: input.parentId,
      agreed: true,
      ...(input.role === undefined ? {} : { role: input.role }),
    },
  );
  yield* jobs.clearPartSpec(input.id);
  // The card shows which model a step used (D148).
  yield* jobs.refine(input.id, {
    by: "baton",
    at: DateTime.formatIso(DateTime.makeUnsafe(yield* Clock.currentTimeMillis)),
    via: "thread",
    text: `Model: ${result.model}${input.routine === true ? " (routine step, cheap model)" : ""}`,
  });
  return { id: input.id, threadId: result.threadId };
});

/**
 * Splits an agreed job into parts, each its own worker started already agreed (the parent's plan
 * named them), inside the parent's own permissions. A part that waits on earlier ones is recorded
 * and started when they are done. Refused for a plan not yet agreed.
 */
export const splitJob = Effect.fn("BatonJobFlow.split")(function* (input: BatonJobSplitInput) {
  const jobs = yield* BatonJobService;
  const parent = yield* jobs.terms(input.id);
  if (parent === null || parent.phase !== "approved") return [];
  const workSession = yield* (yield* WorkSessionService).get(input.id);
  const started: Array<{ readonly id: WorkSessionId; readonly threadId: ThreadId }> = [];
  const partId = (n: number) => WorkSessionId.make(`${input.id}-part-${n}`);
  for (const [i, part] of input.parts.slice(0, MAX_PARTS).entries()) {
    const id = partId(i + 1);
    // Only earlier parts can be waited on, so there is no cycle to find.
    const after = [...new Set(part.after ?? [])].filter((n) => n >= 1 && n <= i).map(partId);
    if (after.length === 0) {
      const one = yield* launchPart({ parentId: input.id, id, ...part });
      if (one !== null) started.push(one);
      continue;
    }
    yield* jobs.create({
      id,
      projectId: workSession.projectId,
      title: part.title,
      goal: part.goal,
      permissions: parent.permissions,
      parentId: input.id,
      partSpec: {
        after,
        ...(part.role === undefined ? {} : { role: part.role }),
        ...(part.routine === true ? { routine: true } : {}),
      },
    });
  }
  return started;
});

/**
 * Starts the parts whose earlier parts are all done, and marks a part that can never start because one
 * it waits on failed. True when something started or was blocked, so the caller waits for the next change.
 */
export const releaseWaiting = Effect.fn("BatonJobFlow.releaseWaiting")(function* (
  parentId: WorkSessionId,
  entries: ReadonlyArray<BatonFleetEntry>,
) {
  const jobs = yield* BatonJobService;
  const all = yield* jobs.parts(parentId);
  const cards = yield* jobs.view({ entries });
  const group = new Map(cards.map((c) => [c.workSessionId as string, c.group]));
  let changed = false;
  for (const part of all) {
    if (part.partSpec === null) continue;
    const states = part.partSpec.after.map((id) => group.get(id));
    const failed = part.partSpec.after.filter((_, i) => states[i] === "failed");
    if (failed.length > 0) {
      const at = DateTime.formatIso(DateTime.makeUnsafe(yield* Clock.currentTimeMillis));
      yield* jobs.refine(part.workSessionId, {
        by: "baton",
        at,
        via: "thread",
        text: `${BLOCKED_MARK} ${failed.join(", ")} failed`,
      });
      yield* jobs.clearPartSpec(part.workSessionId);
      changed = true;
    } else if (states.every((g) => g === "done")) {
      const title = entries.find((e) => e.workSessionId === part.workSessionId)?.title;
      const ws = yield* (yield* WorkSessionService).get(part.workSessionId);
      yield* launchPart({
        parentId,
        id: part.workSessionId,
        title: title ?? ws.title,
        goal: part.goal,
        role: part.partSpec.role,
        routine: part.partSpec.routine,
      });
      changed = true;
    }
  }
  return changed;
});

/**
 * When every part has settled, one summary goes to the parent's thread, once: what each did and
 * what failed, read from the cards and the watch. The mark in the parent's record keeps it once.
 */
export const summarizeParts = Effect.fn("BatonJobFlow.summarizeParts")(function* (
  parentId: WorkSessionId,
  entries: ReadonlyArray<BatonFleetEntry>,
) {
  const jobs = yield* BatonJobService;
  const parent = yield* jobs.terms(parentId);
  if (parent === null || parent.revisions.some((r) => r.text.startsWith(SUMMARY_MARK)))
    return false;
  const parts = (yield* jobs.view({ entries })).filter((j) => j.terms.parentId === parentId);
  // A part still waiting to start, or never started because one it needed failed, has no thread yet.
  const rest = (yield* jobs.parts(parentId)).filter(
    (t) => !parts.some((p) => p.workSessionId === t.workSessionId),
  );
  if (rest.some((t) => t.partSpec !== null)) return false;
  if (!partsSettled(parts)) return false;
  const threadId = yield* threadOf(parentId);
  if (threadId === null) return false;
  const now = yield* Clock.currentTimeMillis;
  const workSessions = yield* WorkSessionService;
  const blocked = yield* Effect.forEach(
    rest.filter((t) => t.revisions.some((r) => r.text.startsWith(BLOCKED_MARK))),
    (t) =>
      Effect.map(workSessions.get(t.workSessionId), (ws) => ({
        title: ws.title,
        why: t.revisions
          .find((r) => r.text.startsWith(BLOCKED_MARK))!
          .text.slice(BLOCKED_MARK.length)
          .trim(),
      })),
  );
  const text = partsSummary({
    blocked,
    parentTitle: entries.find((e) => e.workSessionId === parentId)?.title ?? parentId,
    parts,
    findings: watchFleet(entries, now),
  });
  const at = DateTime.formatIso(DateTime.makeUnsafe(now));
  yield* jobs.refine(parentId, { by: "baton", at, via: "thread", text });
  return yield* (yield* BatonEngine).sendMessage({ tag: "job", threadId, text });
});

/** A thread changed: if it is a part, the coordinator looks at whether its parent's parts are all in. */
export const noticePart = Effect.fn("BatonJobFlow.noticePart")(function* (threadId: ThreadId) {
  const id = yield* (yield* WorkSessionService).findForThread(threadId);
  if (id === null) return;
  const terms = yield* (yield* BatonJobService).terms(id);
  if (terms?.parentId == null) return;
  const entries = (yield* FleetQuery.getFleet({})).entries;
  // Starting a waiting part changes the fleet; the summary waits for the next change.
  if (yield* releaseWaiting(terms.parentId, entries)) return;
  yield* summarizeParts(terms.parentId, entries);
});
