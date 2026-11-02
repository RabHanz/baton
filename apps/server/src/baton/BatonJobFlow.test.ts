import { ProjectId, ThreadId, WorkSessionId } from "@t3tools/baton-contracts";
import { ProviderInstanceId, type OrchestrationV2ThreadShell } from "@t3tools/contracts";
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, it } from "@effect/vitest";
import * as ServerConfig from "../config.ts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { layerMemory as SqlitePersistenceMemory } from "./BatonDatabase.ts";
import {
  agreeJob,
  enforceCaps,
  postReports,
  noticePlan,
  refineJob,
  releaseWaiting,
  scheduleJob,
  splitJob,
  startJob,
  summarizeParts,
} from "./BatonJobFlow.ts";
import { ScheduledTaskService } from "../scheduledTasks/ScheduledTaskService.ts";
import { layerStatic, type BatonThreadLaunch } from "./BatonEngine.ts";
import { BatonJobService, layer as jobLayer } from "./BatonJobService.ts";
import { layer as workSessionLayer } from "./WorkSessionService.ts";

const launched: BatonThreadLaunch[] = [];
const sent: Array<{ threadId: ThreadId; text: string }> = [];
const shells: OrchestrationV2ThreadShell[] = [];
const messages: Array<{ role: "user" | "assistant"; text: string }> = [];
const interrupted: ThreadId[] = [];
const runs = new Map<string, ReadonlyArray<{ status: string }>>();
const BRIEF = [
  "Job brief",
  "The job: x",
  "Desired outcomes",
  "Leverage point",
  "Build or do not build",
  "Steps",
  "Specialists",
  "Reversibility",
  "Permissions",
].join("\n");

const serverConfig = Layer.succeed(ServerConfig.ServerConfig, {
  dbPath: NodePath.join(NodeOS.tmpdir(), "baton-flow-test", "state.sqlite"),
} as never);

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
    serverConfig,
    layerStatic({
      launch: (launch) => (launched.push(launch), launch.threadId ?? null),
      sent,
      shells,
      messages,
      runs,
      interrupted,
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
      assert.include(launched[0]?.text ?? "", "How to frame this job");

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
        // A plan with no job brief is asked for it once, and is not ready yet.
        messages.push({ role: "assistant", text: "I will just do it." });
        yield* noticePlan(ta);
        assert.strictEqual((yield* jobs.terms(a))?.phase, "drafting_plan");
        assert.include(sent.at(-1)?.text ?? "", "Show the job brief");
        assert.strictEqual(sent.length, before + 1);
        // Asked once only: the second time the plan stands as it is.
        yield* noticePlan(ta);
        assert.strictEqual((yield* jobs.terms(a))?.phase, "awaiting_agreement");
        messages.length = 0;
        messages.push({ role: "assistant", text: BRIEF });
        yield* noticePlan(tb);
        assert.strictEqual((yield* jobs.terms(b))?.phase, "approved");
        assert.strictEqual(sent.slice(before).filter((m) => m.threadId === tb).length, 1);
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

  it.effect(
    "splits an agreed job into agreed parts, and writes one summary when they are all in",
    () =>
      Effect.gen(function* () {
        const jobs = yield* BatonJobService;
        const parent = WorkSessionId.make("job-flow-4");
        const { threadId } = yield* startJob({
          id: parent,
          projectId: ProjectId.make("project-site"),
          title: "Site",
          goal: "do the site",
          permissions: {
            folders: ["~/site"],
            projects: [],
            tools: ["read" as const, "edit" as const],
          },
          modelSelection: { instanceId: ProviderInstanceId.make("claude"), model: "sonnet" },
          runtimeMode: "approval-required",
        });
        const shell = (id: ThreadId) =>
          ({
            id,
            status: "completed",
            modelSelection: { instanceId: "claude", model: "sonnet" },
          }) as unknown as OrchestrationV2ThreadShell;
        shells.push(shell(threadId));
        assert.lengthOf(yield* splitJob({ id: parent, parts: [{ title: "A", goal: "do a" }] }), 0);
        yield* agreeJob(parent);
        const before = launched.length;
        const started = yield* splitJob({
          id: parent,
          parts: [
            { title: "Copy", goal: "write the copy", role: "marketing", routine: true },
            { title: "Code", goal: "build the page" },
          ],
        });
        assert.lengthOf(started, 2);
        const mine = launched.slice(before);
        assert.deepEqual(
          mine.map((l) => l.interactionMode),
          ["default", "default"],
        );
        assert.include(mine[0]?.text ?? "", "Your role (marketing)");
        assert.include(mine[0]?.text ?? "", "already agreed");
        // Routine work runs on the cheap model of the routing table; the rest on the parent's.
        assert.deepEqual(
          mine.map((l) => l.modelSelection.model),
          ["haiku", "sonnet"],
        );
        const parts = yield* jobs.parts(parent);
        assert.deepEqual(
          parts.map((p) => [p.parentId, p.phase, p.permissions.tools.length]),
          [
            [parent, "approved", 2],
            [parent, "approved", 2],
          ],
        );
        const entry = (id: string, state: string) =>
          ({
            workSessionId: id,
            title: id,
            lifecycle: "active",
            state,
            updatedAt: "2026-11-03T10:00:00.000Z",
            threads: [],
            synopsis: null,
          }) as never;
        const sentBefore = sent.length;
        const running = [
          entry(parent, "working"),
          entry(parts[0]!.workSessionId, "done_unseen"),
          entry(parts[1]!.workSessionId, "working"),
        ];
        assert.isFalse(yield* summarizeParts(parent, running));
        const done = [
          entry(parent, "working"),
          entry(parts[0]!.workSessionId, "done_unseen"),
          entry(parts[1]!.workSessionId, "failed"),
        ];
        assert.isTrue(yield* summarizeParts(parent, done));
        assert.isFalse(yield* summarizeParts(parent, done));
        assert.lengthOf(sent.slice(sentBefore), 1);
        assert.include(sent.at(-1)?.text ?? "", "Summary of the parts:");
        assert.include(sent.at(-1)?.text ?? "", "1 of 2 failed or did not start");
      }),
  );

  it.effect(
    "starts a part only when the parts it waits on are done, and blocks it when one fails",
    () =>
      Effect.gen(function* () {
        const jobs = yield* BatonJobService;
        const parent = WorkSessionId.make("job-flow-5");
        const { threadId } = yield* startJob({
          id: parent,
          projectId: ProjectId.make("project-site"),
          title: "Pipeline",
          goal: "do the pipeline",
          permissions: { folders: [], projects: [], tools: ["read" as const] },
          modelSelection: { instanceId: ProviderInstanceId.make("claude"), model: "sonnet" },
          runtimeMode: "approval-required",
        });
        shells.push({
          id: threadId,
          status: "completed",
          modelSelection: { instanceId: "claude", model: "sonnet" },
        } as unknown as OrchestrationV2ThreadShell);
        yield* agreeJob(parent);
        const before = launched.length;
        const started = yield* splitJob({
          id: parent,
          parts: [
            { title: "Fetch", goal: "fetch it" },
            { title: "Clean", goal: "clean it", after: [1] },
            { title: "Report", goal: "report on it", after: [1, 2, 7] },
          ],
        });
        assert.lengthOf(started, 1);
        assert.lengthOf(launched.slice(before), 1);
        const [p1, p2, p3] = (yield* jobs.parts(parent)).map((p) => p.workSessionId);
        assert.deepEqual((yield* jobs.terms(p3!))?.partSpec?.after, [p1!, p2!]);
        const entry = (id: string, state: string) =>
          ({
            workSessionId: id,
            title: id,
            lifecycle: "active",
            state,
            updatedAt: "2026-11-03T10:00:00.000Z",
            threads: [],
            synopsis: null,
          }) as never;

        // The first is still running: nothing else starts.
        assert.isFalse(
          yield* releaseWaiting(parent, [entry(parent, "working"), entry(p1!, "working")]),
        );
        // The first is done: the second starts, the third still waits on it.
        assert.isTrue(
          yield* releaseWaiting(parent, [entry(parent, "working"), entry(p1!, "done_unseen")]),
        );
        assert.lengthOf(launched.slice(before), 2);
        assert.isNull((yield* jobs.terms(p2!))?.partSpec);
        assert.isNotNull((yield* jobs.terms(p3!))?.partSpec);
        // The second fails: the third is never started, says why, and the summary counts it.
        const sentBefore = sent.length;
        const e = [entry(parent, "working"), entry(p1!, "done_unseen"), entry(p2!, "failed")];
        assert.isTrue(yield* releaseWaiting(parent, e));
        assert.lengthOf(launched.slice(before), 2);
        assert.isNull((yield* jobs.terms(p3!))?.partSpec);
        assert.isTrue(yield* summarizeParts(parent, e));
        const text = sent.slice(sentBefore).at(-1)?.text ?? "";
        assert.include(text, "- Report: not started.");
        assert.include(text, "2 of 3 failed or did not start");
      }),
  );

  it.effect("stops an agreed job whose worker has used its turns, once, and says why", () =>
    Effect.gen(function* () {
      const jobs = yield* BatonJobService;
      const id = WorkSessionId.make("job-cap-1");
      const { threadId } = yield* startJob({
        id,
        projectId: ProjectId.make("project-site"),
        title: "Capped",
        goal: "Do the thing",
        permissions: { folders: [], projects: [], tools: ["read"] },
        limits: { workerTurns: 2, wallClockMinutes: 600 },
        modelSelection: { instanceId: ProviderInstanceId.make("claude"), model: "sonnet" },
        runtimeMode: "approval-required",
      });
      shells.push({ id: threadId, status: "completed" } as OrchestrationV2ThreadShell);
      yield* jobs.planReady(id);
      yield* agreeJob(id);
      const entry = (state: string) =>
        [
          {
            workSessionId: id,
            title: "Capped",
            lifecycle: "active",
            state,
            updatedAt: "2026-11-03T10:00:00.000Z",
            threads: [{ threadId }],
            synopsis: null,
          },
        ] as never;
      interrupted.length = 0;
      runs.set(threadId, [{ status: "completed" }, { status: "queued" }]);
      assert.deepStrictEqual(yield* enforceCaps(entry("working")), []);
      runs.set(threadId, [{ status: "completed" }, { status: "running" }, { status: "cancelled" }]);
      assert.deepStrictEqual(yield* enforceCaps(entry("working")), [id]);
      assert.deepStrictEqual(interrupted, [threadId]);
      // Once stopped it is not working, so a second sweep leaves it alone.
      assert.deepStrictEqual(yield* enforceCaps(entry("idle")), []);
      const terms = yield* jobs.terms(id);
      assert.isTrue(terms?.revisions.some((r) => r.text.includes("reached its turns limit")));
    }),
  );

  it.effect(
    "trips the dollar cap on what the worker's own log priced, and shows tokens and dollars",
    () =>
      Effect.gen(function* () {
        const jobs = yield* BatonJobService;
        const id = WorkSessionId.make("job-cap-dollars");
        const { threadId } = yield* startJob({
          id,
          projectId: ProjectId.make("project-site"),
          title: "Priced",
          goal: "Do the thing",
          permissions: { folders: [], projects: [], tools: ["read"] },
          limits: { workerTurns: 40, wallClockMinutes: 600, dollars: 1 },
          modelSelection: { instanceId: ProviderInstanceId.make("claude"), model: "sonnet" },
          runtimeMode: "approval-required",
        });
        shells.push({ id: threadId, status: "completed" } as OrchestrationV2ThreadShell);
        yield* jobs.planReady(id);
        yield* agreeJob(id);
        const entries = [
          {
            workSessionId: id,
            title: "Priced",
            lifecycle: "active",
            state: "working",
            updatedAt: "2026-11-03T10:00:00.000Z",
            threads: [{ threadId }],
            synopsis: null,
          },
        ] as never;
        const under = yield* jobs.view({
          entries,
          spend: new Map([[id, { tokens: 10, dollars: 0.4, partial: false }]]),
        });
        assert.isNull(under.find((j) => j.workSessionId === id)?.limitReached);
        const over = yield* jobs.view({
          entries,
          spend: new Map([[id, { tokens: 900, dollars: 1.2, partial: true }]]),
        });
        const card = over.find((j) => j.workSessionId === id);
        assert.strictEqual(card?.limitReached, "spend");
        assert.deepInclude(card?.usage ?? {}, { tokens: 900, dollars: 1.2, partial: true });
        // Nothing priced yet is not zero spend: the cap does not trip on a missing figure.
        const none = yield* jobs.view({
          entries,
          spend: new Map([[id, { tokens: 0, dollars: null, partial: true }]]),
        });
        assert.isNull(none.find((j) => j.workSessionId === id)?.limitReached);
      }),
  );

  it.effect("writes a progress report into a running job's record once per cadence, from state", () =>
    Effect.gen(function* () {
      const jobs = yield* BatonJobService;
      const id = WorkSessionId.make("job-report-1");
      const { threadId } = yield* startJob({
        id,
        projectId: ProjectId.make("project-site"),
        title: "Reported",
        goal: "Do the thing",
        permissions: { folders: [], projects: [], tools: ["read"] },
        limits: { reportEveryMinutes: 1 },
        modelSelection: { instanceId: ProviderInstanceId.make("claude"), model: "sonnet" },
        runtimeMode: "approval-required",
      });
      shells.push({ id: threadId, status: "completed" } as OrchestrationV2ThreadShell);
      yield* jobs.planReady(id);
      yield* agreeJob(id);
      const entries = [
        {
          workSessionId: id,
          title: "Reported",
          lifecycle: "active",
          state: "working",
          needsUser: false,
          updatedAt: "2026-11-03T10:00:00.000Z",
          threads: [{ threadId }],
          synopsis: {
            currentAction: "running the tests",
            recentFindings: [{ text: "fixed the import" }],
            changedFiles: ["a.ts"],
            next: ["rebuild"],
            validation: [{ label: "tests", outcome: "failed" }],
            needsUser: false,
          },
        },
      ] as never;
      // The job was just created, so nothing is due yet.
      assert.deepStrictEqual(yield* postReports(entries), []);
    }),
  );
});
