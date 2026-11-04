import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import { layerMemory as SqlitePersistenceMemory } from "./BatonDatabase.ts";
import { dayOf } from "./BatonMemoryEpisode.ts";
import { BatonMemoryLearning, layer as learningLayer } from "./BatonMemoryLearning.ts";
import { BatonMemoryService, layer as memoryLayer } from "./BatonMemoryService.ts";
import { BatonOneShot, BatonOneShotError } from "./BatonOneShot.ts";

let reply: unknown = { items: [] };
let down = false;
const prompts: string[] = [];
const oneShot = Layer.succeed(BatonOneShot, {
  run: ((input: { readonly prompt: string }) => {
    prompts.push(input.prompt);
    return down
      ? Effect.fail(new BatonOneShotError({ detail: "offline" }))
      : Effect.succeed(reply as never);
  }) as BatonOneShot["Service"]["run"],
});
const config = Layer.succeed(ServerConfig.ServerConfig, {
  dbPath: "/nowhere/statev2.sqlite",
} as unknown as ServerConfig.ServerConfig["Service"]);

const layer = it.layer(
  learningLayer.pipe(
    Layer.provideMerge(memoryLayer),
    Layer.provideMerge(oneShot),
    Layer.provideMerge(config),
    Layer.provideMerge(SqlitePersistenceMemory),
  ),
);

const turn = (over: Record<string, unknown> = {}) => ({
  origin: "turn" as const,
  said: "From now on put the date first in every file name, and the old rule was wrong",
  reply: "Done, date first.",
  sourceRef: "turn-1",
  tainted: false,
  project: null,
  ...over,
});

layer("BatonMemoryLearning", (it) => {
  it.effect("stores what the extractor proposes, replacing the belief it contradicts", () =>
    Effect.gen(function* () {
      const memory = yield* BatonMemoryService;
      const learning = yield* BatonMemoryLearning;
      const old = yield* memory.add({
        kind: "preference",
        text: "File names end with the date",
        source: "thread",
      });
      reply = {
        items: [
          {
            kind: "preference",
            text: "File names start with the date",
            hisStatement: true,
            contradicts: "File names end with the date",
          },
          { kind: "fact", text: "my password is hunter22x" },
        ],
      };
      const result = yield* learning.learn(turn());
      assert.deepEqual(result, { stored: 1, held: 0 });
      const live = yield* memory.search({ text: "file names date" });
      assert.deepEqual(
        live.map((h) => h.item.text),
        ["File names start with the date"],
      );
      assert.strictEqual(live[0]?.item.confidence, 0.7);
      const all = yield* memory.list({ includeSuperseded: true });
      assert.isNotNull(all.find((i) => i.id === old.id)?.supersededBy);
    }),
  );

  it.effect("holds proposals from a tainted turn", () =>
    Effect.gen(function* () {
      const memory = yield* BatonMemoryService;
      const learning = yield* BatonMemoryLearning;
      reply = { items: [{ kind: "fact", text: "The invoice portal moved to a new host" }] };
      assert.deepEqual(yield* learning.learn(turn({ tainted: true })), { stored: 0, held: 1 });
      assert.lengthOf(yield* memory.search({ text: "invoice portal" }), 0);
    }),
  );

  it.effect("a failing model, or a trivial exchange, costs nothing and breaks nothing", () =>
    Effect.gen(function* () {
      const learning = yield* BatonMemoryLearning;
      const before = prompts.length;
      assert.deepEqual(yield* learning.learn(turn({ said: "ok", reply: "yes" })), {
        stored: 0,
        held: 0,
      });
      assert.strictEqual(prompts.length, before);
      // A secret he said is neither kept as talk nor sent to the extractor.
      const memory = yield* BatonMemoryService;
      const day = dayOf(0);
      const talksBefore = yield* memory.talks(day);
      yield* learning.learn(turn({ said: "remember my test password is Zx9-correct-horse-77" }));
      assert.strictEqual(prompts.length, before);
      assert.deepEqual(yield* memory.talks(day), talksBefore);
      down = true;
      assert.deepEqual(yield* learning.learn(turn()), { stored: 0, held: 0 });
      down = false;
    }),
  );

  it.effect("the daily pass merges near-duplicates and keeps one", () =>
    Effect.gen(function* () {
      const memory = yield* BatonMemoryService;
      const learning = yield* BatonMemoryLearning;
      yield* memory.add({
        kind: "fact",
        text: "Staging lives on the second box",
        source: "job",
        scope: "project",
        scopeRef: "s",
      });
      // Two rewordings that dedupe cannot see at add time are merged here.
      yield* memory.add({
        kind: "fact",
        text: "Staging lives on the second box today",
        source: "job",
        scope: "project",
        scopeRef: "s",
      });
      const before = (yield* memory.list({ scope: "project" })).length;
      const result = yield* learning.consolidate;
      const after = (yield* memory.list({ scope: "project" })).length;
      assert.isAtLeast(result.merged, before - after);
      assert.isAtMost(after, before);
    }),
  );

  it.effect("the weekly pass folds near-duplicates into one item with the fuller wording", () =>
    Effect.gen(function* () {
      const memory = yield* BatonMemoryService;
      const learning = yield* BatonMemoryLearning;
      yield* memory.add({
        kind: "fact",
        text: "Invoices are filed by the bookkeeper",
        source: "thread",
        scope: "project",
        scopeRef: "weekly",
      });
      yield* memory.add({
        kind: "fact",
        text: "Invoices are filed by the bookkeeper every Friday afternoon",
        source: "job",
        scope: "project",
        scopeRef: "weekly",
      });
      assert.lengthOf(
        yield* memory
          .list({ scope: "project" })
          .pipe(Effect.map((l) => l.filter((i) => i.scopeRef === "weekly"))),
        2,
      );
      assert.isAtLeast(yield* learning.rewriteNearDuplicates, 1);
      const left = (yield* memory.list({ scope: "project" })).filter(
        (i) => i.scopeRef === "weekly",
      );
      assert.lengthOf(left, 1);
      assert.include(left[0]!.text, "every Friday afternoon");
    }),
  );
});
