import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { layerMemory as SqlitePersistenceMemory } from "./BatonDatabase.ts";
import { pullAction, pullLearnings } from "./BatonMemoryPull.ts";
import { BatonMemoryService, layer as memoryLayer } from "./BatonMemoryService.ts";

const layer = it.layer(memoryLayer.pipe(Layer.provideMerge(SqlitePersistenceMemory)));
const env = { BATON_HISTORY_SEARCH: "/x/search.sh" };
const out = "cc828d1b  venture: shopfront  Learned the supplier needs the invoice before shipping starts\n";

layer("learnings pull", (it) => {
  it.effect("proposes quotes with their session, held for his yes, once", () =>
    Effect.gen(function* () {
      const memory = yield* BatonMemoryService;
      const first = yield* pullLearnings(env, async () => out);
      assert.deepEqual({ found: first.found, held: first.held }, { found: 1, held: 1 });
      assert.lengthOf(yield* memory.search({ text: "supplier invoice" }), 0);
      const held = (yield* memory.list({ includeProposed: true }))[0]!;
      assert.isTrue(held.proposed);
      assert.strictEqual(held.scopeRef, "shopfront");
      assert.strictEqual(held.sourceRef, "session:cc828d1b");
      assert.include(held.text, "supplier needs the invoice");
      const again = yield* pullLearnings(env, async () => out);
      assert.strictEqual(again.found, 0);
    }),
  );

  it.effect("says so plainly without the index, and the switch is kept", () =>
    Effect.gen(function* () {
      const none = yield* pullLearnings({});
      assert.include(none.why ?? "", "not set up");
      assert.isFalse((yield* pullAction("status")).enabled);
      assert.isTrue((yield* pullAction("enable")).enabled);
      assert.isFalse((yield* pullAction("disable")).enabled);
    }),
  );
});
