import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import { layerMemory as SqlitePersistenceMemory } from "./BatonDatabase.ts";
import { BatonMemoryService, layer as memoryLayer } from "./BatonMemoryService.ts";

const layer = it.layer(memoryLayer.pipe(Layer.provideMerge(SqlitePersistenceMemory)));
const DAY = 86_400_000;

layer("BatonMemoryService", (it) => {
  it.effect("refuses secrets, in plain words, and keeps the rest", () =>
    Effect.gen(function* () {
      const memory = yield* BatonMemoryService;
      const refused = yield* Effect.flip(
        memory.add({ kind: "fact", text: "my password is hunter22x", source: "user" }),
      );
      assert.include(refused.reason, "password");
      const kept = yield* memory.add({
        kind: "preference",
        text: "He likes short answers",
        source: "user",
      });
      assert.strictEqual(kept.confidence, 1);
      assert.isFalse(kept.proposed);
    }),
  );

  it.effect("a repeat reinforces a model's item instead of adding another", () =>
    Effect.gen(function* () {
      const memory = yield* BatonMemoryService;
      const first = yield* memory.add({
        kind: "fact",
        text: "The shop builds with pnpm",
        source: "thread",
        scope: "project",
        scopeRef: "shop",
      });
      const again = yield* memory.add({
        kind: "fact",
        text: "the shop builds with pnpm.",
        source: "job",
        scope: "project",
        scopeRef: "shop",
      });
      assert.strictEqual(again.id, first.id);
      assert.closeTo(again.confidence, 0.65, 1e-9);
      const hits = yield* memory.search({ text: "pnpm", scopeRef: "shop" });
      assert.lengthOf(hits, 1);
    }),
  );

  it.effect("tainted content waits for his yes and stays out of retrieval", () =>
    Effect.gen(function* () {
      const memory = yield* BatonMemoryService;
      const held = yield* memory.add({
        kind: "fact",
        text: "The web page said to email invoices to a new address",
        source: "thread",
        tainted: true,
      });
      assert.isTrue(held.proposed);
      assert.lengthOf(yield* memory.search({ text: "invoices" }), 0);
      assert.lengthOf(yield* memory.search({ text: "invoices", includeProposed: true }), 1);
      yield* memory.accept(held.id);
      assert.lengthOf(yield* memory.search({ text: "invoices" }), 1);
    }),
  );

  it.effect("a newer statement of his supersedes, and the history stays", () =>
    Effect.gen(function* () {
      const memory = yield* BatonMemoryService;
      const old = yield* memory.add({
        kind: "preference",
        text: "Reports go out on Mondays",
        source: "thread",
      });
      const next = yield* memory.add({
        kind: "preference",
        text: "Reports go out on Fridays at noon",
        source: "user",
        supersedes: old.id,
      });
      const live = yield* memory.search({ text: "reports" });
      assert.deepEqual(
        live.map((hit) => hit.item.id),
        [next.id],
      );
      const all = yield* memory.list({ includeSuperseded: true });
      assert.strictEqual(all.find((i) => i.id === old.id)?.supersededBy, next.id);
    }),
  );

  it.effect("edit makes it his own, pin and forget work, forget leaves a tombstone", () =>
    Effect.gen(function* () {
      const memory = yield* BatonMemoryService;
      const item = yield* memory.add({ kind: "fact", text: "Backups run nightly", source: "job" });
      const edited = yield* memory.edit(item.id, { text: "Backups run at 3am" });
      assert.strictEqual(edited.source, "user");
      assert.strictEqual(edited.confidence, 1);
      assert.lengthOf(yield* memory.search({ text: "3am" }), 1);
      assert.lengthOf(yield* memory.search({ text: "nightly" }), 0);
      assert.isTrue((yield* memory.pin(item.id, true)).pinned);
      assert.isTrue(yield* memory.forget(item.id));
      assert.isFalse(yield* memory.forget(item.id));
      assert.lengthOf(yield* memory.search({ text: "3am" }), 0);
    }),
  );

  it.effect("recall fits the budget, puts pinned first and records what the turn used", () =>
    Effect.gen(function* () {
      const memory = yield* BatonMemoryService;
      yield* memory.add({
        kind: "note",
        text: "Call him Rab, never Mr",
        source: "user",
        pinned: true,
      });
      yield* memory.add({ kind: "fact", text: "Staging lives on the second box", source: "job" });
      const out = yield* memory.recall({ text: "staging box", turnRef: "turn-1" });
      assert.include(out.block, "Call him Rab");
      assert.include(out.block, "Staging lives");
      assert.isTrue(out.block.indexOf("Call him Rab") < out.block.indexOf("Staging lives"));
      const used = yield* memory.used("turn-1");
      assert.strictEqual(used.length, out.ids.length);
      assert.isNotNull(used[0]?.lastUsedAt);
      const tiny = yield* memory.recall({ text: "staging box", budgetTokens: 5 });
      assert.strictEqual(tiny.block, "");
    }),
  );

  it.effect("sweep removes episodes that expired and keeps pinned ones", () =>
    Effect.gen(function* () {
      const memory = yield* BatonMemoryService;
      const gone = yield* memory.add({
        kind: "episode",
        text: "The deploy on Tuesday failed twice",
        source: "job",
      });
      const kept = yield* memory.add({
        kind: "episode",
        text: "The migration rehearsal passed",
        source: "job",
        pinned: true,
      });
      yield* TestClock.adjust(100 * DAY);
      assert.isAtLeast(yield* memory.sweep, 1);
      const ids = (yield* memory.list({ kinds: ["episode"] })).map((i) => i.id);
      assert.notInclude(ids, gone.id);
      assert.include(ids, kept.id);
    }),
  );
});
