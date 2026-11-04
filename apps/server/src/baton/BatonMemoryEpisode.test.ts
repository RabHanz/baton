import { assert, it } from "@effect/vitest";
import { ProjectId, WorkSessionId } from "@t3tools/baton-contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { layerMemory as SqlitePersistenceMemory } from "./BatonDatabase.ts";
import { BatonJobService, layer as jobLayer } from "./BatonJobService.ts";
import { dailyEpisode } from "./BatonMemoryEpisode.ts";
import { BatonMemoryService, layer as memoryLayer } from "./BatonMemoryService.ts";
import { WorkSessionService, layer as workSessionLayer } from "./WorkSessionService.ts";

const layer = it.layer(
  memoryLayer.pipe(
    Layer.provideMerge(jobLayer),
    Layer.provideMerge(workSessionLayer),
    Layer.provideMerge(SqlitePersistenceMemory),
  ),
);

layer("dailyEpisode", (it) => {
  it.effect(
    "sums up yesterday's talks, jobs and sessions as one episode, once, and nothing on a quiet day",
    () =>
      Effect.gen(function* () {
        const memory = yield* BatonMemoryService;
        const DAY = 86_400_000;
        assert.isNull(yield* dailyEpisode(DAY));
        // A tick that finds nothing yet does not mark the day as done.
        assert.isNull(yield* dailyEpisode(2 * DAY + 3_600_000));
        yield* memory.noteTalk("1970-01-02", "plan the shop launch");
        yield* (yield* BatonJobService).create({
          id: WorkSessionId.make("job-1"),
          projectId: ProjectId.make("p"),
          title: "Site",
          goal: "Rebuild the site",
          permissions: { folders: [], projects: [], tools: ["read"] },
        });
        yield* (yield* WorkSessionService).applySynopsis({
          workSessionId: WorkSessionId.make("job-1"),
          signals: [
            {
              kind: "written",
              at: "1970-01-02T15:00:00.000Z",
              currentAction: "The header is rebuilt and the tests pass",
              next: "Ship it",
            },
          ],
        });
        // Run at 09:00 on the 3rd: the whole of the 2nd, not the morning's first ten minutes.
        const episode = yield* dailyEpisode(2 * DAY + 9 * 3_600_000);
        assert.strictEqual(episode?.kind, "episode");
        assert.include(episode?.text ?? "", "1970-01-02");
        assert.include(episode?.text ?? "", "plan the shop launch");
        assert.include(episode?.text ?? "", "Site: The header is rebuilt");
        assert.isNotNull(episode?.expiresAt);
        // A restart the same day writes no second episode for the 2nd.
        assert.isNull(yield* dailyEpisode(2 * DAY + 10 * 3_600_000));
      }),
  );
});
