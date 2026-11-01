import { ProjectId, ThreadId, WorkSessionId } from "@t3tools/baton-contracts";
import { ProviderInstanceId, type OrchestrationV2ThreadShell } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { layerMemory as SqlitePersistenceMemory } from "./BatonDatabase.ts";
import { agreeJob, refineJob, startJob } from "./BatonJobFlow.ts";
import { layerStatic, type BatonThreadLaunch } from "./BatonEngine.ts";
import { BatonJobService, layer as jobLayer } from "./BatonJobService.ts";
import { layer as workSessionLayer } from "./WorkSessionService.ts";

const launched: BatonThreadLaunch[] = [];
const sent: Array<{ threadId: ThreadId; text: string }> = [];
const shells: OrchestrationV2ThreadShell[] = [];

const layer = it.layer(
  Layer.mergeAll(
    jobLayer,
    layerStatic({
      launch: (launch) => (launched.push(launch), launch.threadId ?? null),
      sent,
      shells,
    }),
  ).pipe(
    Layer.provideMerge(workSessionLayer),
    Layer.provideMerge(SqlitePersistenceMemory),
  ),
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
      assert.deepEqual(sent.map((s) => s.text), ["Use the blue palette"]);
      const agreed = yield* agreeJob(id);
      assert.strictEqual(agreed?.phase, "approved");
      assert.lengthOf(sent, 2);
      assert.strictEqual(sent[1]?.threadId, threadId);
      yield* agreeJob(id);
      assert.lengthOf(sent, 2);
    }),
  );
});
