// @effect-diagnostics nodeBuiltinImport:off
/**
 * The job's flow from his words to work (D145): the worker thread is made in plan mode with his
 * words verbatim, and only his agreement (or a standing "start" grant at plan time) lets it work.
 * The RPC handlers, the desktop tools and the phone all call these; none holds the flow itself.
 */
import {
  type BatonJobRefineInput,
  type BatonJobScheduleInput,
  type BatonJobStartInput,
  WorkSessionId,
} from "@t3tools/baton-contracts";
import { permissionsSummary, workerFirstMessage } from "@t3tools/baton-shared/jobs";
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
import { planningFrame } from "./OperatingSystemPack.ts";
import { BatonJobService } from "./BatonJobService.ts";
import * as FleetQuery from "./FleetQuery.ts";
import { WorkSessionService } from "./WorkSessionService.ts";

const threadOf = Effect.fn("BatonJobFlow.threadOf")(function* (id: WorkSessionId) {
  const workSession = yield* (yield* WorkSessionService).get(id);
  return (
    workSession.providerSessions.find((session) => session.detachedAt === null)?.threadId ?? null
  );
});

export const startJob = Effect.fn("BatonJobFlow.start")(function* (input: BatonJobStartInput) {
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
  });
  // A retried start finds the thread it already made.
  const existing = yield* threadOf(id);
  if (existing !== null) return { terms, threadId: existing };
  const workSession = yield* workSessions.get(id);
  const threadId = ThreadIdSchema.make(`job-thread-${yield* uuid}`);
  const launched = yield* engine.launchThread({
    tag: "job",
    threadId,
    projectId: input.projectId,
    title: input.title,
    modelSelection: input.modelSelection,
    runtimeMode: input.runtimeMode,
    interactionMode: "plan",
    worktreePath: workSession.primaryWorktreePath,
    branch: workSession.baseBranch,
    text: workerFirstMessage({
      verbatim: input.goal,
      frame: planningFrame(NodePath.dirname((yield* ServerConfig.ServerConfig).dbPath)),
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
  return { terms, threadId: launched };
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

export const listJobs = Effect.fn("BatonJobFlow.list")(function* () {
  const jobs = yield* BatonJobService;
  const fleet = yield* FleetQuery.getFleet({});
  return yield* jobs.view({ entries: fleet.entries });
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
  const shell = yield* (yield* BatonEngine).threadShell(threadId);
  if (shell?.status !== "completed") return;
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
