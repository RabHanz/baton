// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import * as ServerConfig from "../config.ts";
import { layerMemory as SqlitePersistenceMemory } from "./BatonDatabase.ts";
import { BatonMemoryEmbedder, layerNone } from "./BatonMemoryEmbedder.ts";
import { BatonMemoryService, MemoryViewer, layer as memoryLayer } from "./BatonMemoryService.ts";

/** A stand-in model: each word lands on one axis, so "pricing" and "costs" are near and "train" is far. */
const AXIS: Readonly<Record<string, number>> = {
  pricing: 0,
  price: 0,
  costs: 0,
  subscription: 0,
  train: 1,
  travel: 1,
};
const embedded: string[] = [];
const fakeModel = Layer.succeed(BatonMemoryEmbedder, {
  model: "fake-model",
  embed: (text) =>
    Effect.sync(() => {
      embedded.push(text);
      const v = new Float32Array(2);
      for (const w of text.toLowerCase().match(/[a-z]+/g) ?? []) {
        const axis = AXIS[w];
        if (axis !== undefined) v[axis]! += 1;
      }
      const n = Math.hypot(...v) || 1;
      return v.map((x) => x / n);
    }),
});

const withModel = (model: Layer.Layer<BatonMemoryEmbedder>, extra = Layer.empty) =>
  Layer.mergeAll(
    memoryLayer.pipe(Layer.provide(model), Layer.provideMerge(SqlitePersistenceMemory)),
    extra,
  );

const PRICE = "The subscription costs twenty pounds a month";
const TRAIN = "He takes the train on Mondays";
const ASK = "what did we decide about pricing";

it.effect(
  "recalls by meaning what shares no word with the sentence, once the background pass has embedded it",
  () =>
    Effect.gen(function* () {
      const memory = yield* BatonMemoryService;
      yield* memory.add({ kind: "fact", text: PRICE, source: "user" });
      yield* memory.add({ kind: "fact", text: TRAIN, source: "user" });
      // Not embedded yet (the pass waits a minute after start): keywords alone find nothing.
      assert.notInclude((yield* memory.recall({ text: ASK })).block, "subscription");
      yield* TestClock.adjust("2 minutes");
      const block = (yield* memory.recall({ text: ASK })).block;
      assert.include(block, "subscription costs");
      assert.notInclude(block, "train");
      // An edit is embedded again after it commits, not in the edit's own path.
      const item = (yield* memory.list({ admin: true })).find((i) => i.text === TRAIN)!;
      embedded.length = 0;
      yield* memory.edit(item.id, { text: "He travels by train on Mondays" });
      assert.deepStrictEqual(embedded, []);
      yield* TestClock.adjust("1 second");
      assert.include(embedded, "He travels by train on Mondays");
    }).pipe(Effect.provide(withModel(fakeModel))),
);

it.effect("applies the walls before ranking by meaning: a walled item is never a candidate", () => {
  const userdata = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "baton-meaning-walls-"));
  const pack = NodePath.join(userdata, "operating-system");
  NodeFS.mkdirSync(NodePath.join(pack, "roles"), { recursive: true });
  NodeFS.writeFileSync(NodePath.join(pack, "executive.md"), "---\nwalled: Shop\n---\n");
  NodeFS.writeFileSync(
    NodePath.join(pack, "roles", "engineering.md"),
    "---\nprojects: shop\n---\n",
  );
  const config = Layer.succeed(ServerConfig.ServerConfig, {
    dbPath: NodePath.join(userdata, "state.sqlite"),
  } as never);
  return Effect.gen(function* () {
    const memory = yield* BatonMemoryService;
    yield* memory.add({
      kind: "fact",
      text: "The shop subscription costs ten pounds",
      source: "user",
      scope: "project",
      scopeRef: "shop",
    });
    yield* TestClock.adjust("2 minutes");
    // Freya is not on the shop's team: the nearest item by meaning is behind the wall, so nothing comes back.
    assert.notInclude((yield* memory.recall({ text: ASK, agent: "operations" })).block, "shop");
    assert.include(
      (yield* memory.recall({ text: ASK, agent: "engineering" })).block,
      "shop subscription",
    );
  }).pipe(
    Effect.provideService(MemoryViewer, "desktop"),
    Effect.provide(withModel(fakeModel, config)),
  );
});

it.effect("without a model, recall is keyword recall as before", () =>
  Effect.gen(function* () {
    const memory = yield* BatonMemoryService;
    yield* memory.add({ kind: "fact", text: PRICE, source: "user" });
    yield* TestClock.adjust("2 minutes");
    assert.notInclude((yield* memory.recall({ text: ASK })).block, "subscription");
    assert.include((yield* memory.recall({ text: "subscription" })).block, "subscription costs");
  }).pipe(Effect.provide(withModel(layerNone))),
);
