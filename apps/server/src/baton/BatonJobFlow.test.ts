import { ProjectId, ThreadId, WorkSessionId } from "@t3tools/baton-contracts";
import { ProviderInstanceId, type OrchestrationV2ThreadShell } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { layerMemory as SqlitePersistenceMemory } from "./BatonDatabase.ts";
import { agreeJob, noticePlan, refineJob, scheduleJob, startJob } from "./BatonJobFlow.ts";
import { ScheduledTaskService } from "../scheduledTasks/ScheduledTaskService.ts";
import { layerStatic, type BatonThreadLaunch } from "./BatonEngine.ts";
import { BatonJobService, layer as jobLayer } from "./BatonJobService.ts";
import { layer as workSessionLayer } from "./WorkSessionService.ts";

const launched: BatonThreadLaunch[] = [];
const sent: Array<{ threadId: ThreadId; text: string }> = [];
const shells: OrchestrationV2ThreadShell[] = [];

const upserts: Array<{ threadId?: unknown; schedule: unknown; id?: unknown }> = [];
const deleted: unknown[] = [];
const scheduledTasks = Layer.succeed(ScheduledTaskService, {
  upsert: (input: (typeof upserts)[number]) =>
    Effect.sync(() => {
      upserts.push(input);
      return { task: { id: "task-1" } };
    }),
  delete: ({ id }: { id: unknown }) => Effect.sync(() => (deleted.push(id), { id })),
} as never);

const layer = it.layer(
  Layer.mergeAll(
    jobLayer,
    scheduledTasks,
    layerStatic({
      launch: (launch) => (launched.push(launch), launch.threadId ?? null),
      sent,
      shells,
    }),
  ).pipe(Layer.provideMerge(workSessionLayer), Layer.provideMerge(SqlitePersistenceMemory)),
);

layer("BatonJobFlow", (it) => {
  it.effect("plans first with his words verbatim, and works only after he agrees, once", () =>
    Effect.gen(function* () {
      const jobs = yield* BatonJobService;
      const id = WorkSessionId.make("job-flow-1");
      const goal = "Rebuild   the site, keep the logo";
      const { threadId } = yield* startJob({
        id,
        projectId: ProjectId.make("project-site"),
        title: "Rebuild the site",
        goal,
        permissions: { folders: ["~/dev/site"], projects: ["Site"], tools: ["read", "edit"] },
        modelSelection: { instanceId: ProviderInstanceId.make("claude"), model: "sonnet" },
        runtimeMode: "approval-required",
      });
      assert.strictEqual(launched[0]?.interactionMode, "plan");
      assert.include(launched[0]?.text ?? "", `He asked: ${goal}`);
      assert.include(launched[0]?.text ?? "", "Do not start the work");

      // Agreeing before the plan exists starts nothing.
      yield* agreeJob(id);
      assert.lengthOf(sent, 0);

      // Its planning turn ends: the plan is written, and a refinement asks for it again.
      shells.push({ id: threadId, status: "completed" } as OrchestrationV2ThreadShell);
      yield* jobs.planReady(id);
      yield* refineJob({ id, text: "Use the blue palette", via: "voice" });
      assert.deepEqual(
        sent.map((s) => s.text),
        ["Use the blue palette"],
      );
      const agreed = yield* agreeJob(id);
      assert.strictEqual(agreed?.phase, "approved");
      assert.lengthOf(sent, 2);
      assert.strictEqual(sent[1]?.threadId, threadId);
      yield* agreeJob(id);
      assert.lengthOf(sent, 2);
    }),
  );

  it.effect(
    "notices a finished plan by itself, and starts only a job he gave a standing start",
    () =>
      Effect.gen(function* () {
        const jobs = yield* BatonJobService;
        const base = {
          projectId: ProjectId.make("project-site"),
          permissions: { folders: [], projects: [], tools: ["read" as const] },
          modelSelection: { instanceId: ProviderInstanceId.make("claude"), model: "sonnet" },
          runtimeMode: "approval-required" as const,
        };
        const a = WorkSessionId.make("job-flow-2");
        const b = WorkSessionId.make("job-flow-3");
        const ta = (yield* startJob({ ...base, id: a, title: "A", goal: "do a" })).threadId;
        const tb = (yield* startJob({ ...base, id: b, title: "B", goal: "do b" })).threadId;
        yield* jobs.grant(b, "start");
        const before = sent.length;
        yield* noticePlan(ta);
        assert.strictEqual((yield* jobs.terms(a))?.phase, "drafting_plan");
        shells.push(
          { id: ta, status: "completed" } as OrchestrationV2ThreadShell,
          { id: tb, status: "completed" } as OrchestrationV2ThreadShell,
        );
        yield* noticePlan(ta);
        yield* noticePlan(tb);
        assert.strictEqual((yield* jobs.terms(a))?.phase, "awaiting_agreement");
        assert.strictEqual((yield* jobs.terms(b))?.phase, "approved");
        assert.deepEqual(
          sent.slice(before).map((m) => m.threadId),
          [tb],
        );
      }),
  );

  it.effect("schedules an agreed job in its own thread, and takes the schedule off", () =>
    Effect.gen(function* () {
      const jobs = yield* BatonJobService;
      const id = WorkSessionId.make("job-flow-2");
      const waiting = yield* scheduleJob({ id, everyMinutes: 60 });
      assert.lengthOf(upserts, 0);
      assert.strictEqual(waiting?.scheduleTaskId, null);
      yield* agreeJob(id);
      const set = yield* scheduleJob({ id, everyMinutes: 1440 });
      assert.lengthOf(upserts, 1);
      assert.deepEqual(upserts[0]?.schedule, { type: "interval", everyMs: 86_400_000 });
      assert.strictEqual(set?.scheduleTaskId, "task-1");
      const off = yield* scheduleJob({ id, everyMinutes: null });
      assert.deepEqual(deleted, ["task-1"]);
      assert.strictEqual(off?.scheduleTaskId, null);
      assert.strictEqual((yield* jobs.terms(id))?.scheduleTaskId, null);
    }),
  );
});
