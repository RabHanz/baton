import { assert, it } from "@effect/vitest";
import { ProjectId, WorkSessionId } from "@t3tools/baton-contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { layerMemory as SqlitePersistenceMemory } from "./BatonDatabase.ts";
import { BatonJobService, layer as jobLayer } from "./BatonJobService.ts";
import { dailyEpisode } from "./BatonMemoryEpisode.ts";
import { BatonMemoryService, layer as memoryLayer } from "./BatonMemoryService.ts";
import { layer as workSessionLayer } from "./WorkSessionService.ts";

const layer = it.layer(
  memoryLayer.pipe(
    Layer.provideMerge(jobLayer),
    Layer.provideMerge(workSessionLayer),
    Layer.provideMerge(SqlitePersistenceMemory),
  ),
);

layer("dailyEpisode", (it) => {
  it.effect("sums up the day's talks and jobs as one episode, and nothing on a quiet day", () =>
    Effect.gen(function* () {
      const memory = yield* BatonMemoryService;
      assert.isNull(yield* dailyEpisode(0));
      yield* memory.noteTalk("1970-01-01", "plan the shop launch");
      yield* (yield* BatonJobService).create({
        id: WorkSessionId.make("job-1"),
        projectId: ProjectId.make("p"),
        title: "Site",
        goal: "Rebuild the site",
        permissions: { folders: [], projects: [], tools: ["read"] },
      });
      const episode = yield* dailyEpisode(0);
      assert.strictEqual(episode?.kind, "episode");
      assert.include(episode?.text ?? "", "plan the shop launch");
      assert.include(episode?.text ?? "", "Rebuild the site");
      assert.isNotNull(episode?.expiresAt);
    }),
  );
});
