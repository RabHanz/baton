// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { layerMemory as SqlitePersistenceMemory } from "./BatonDatabase.ts";
import { pullAction, pullLearnings, searchHistory } from "./BatonMemoryPull.ts";
import * as ServerConfig from "../config.ts";
import {
  BatonMemoryService,
  layer as memoryLayer,
  MemoryPrivateTexts,
  MemoryViewer,
} from "./BatonMemoryService.ts";
import { BatonMemorySync } from "./BatonMemorySync.ts";

// What the paired peers answer, and what they were asked; `setup()` resets both at the top of each test.
const state: { peer: { found: boolean; text: string } | null; asked: Array<unknown> } = {
  peer: null,
  asked: [],
};
const setup = (peer: { found: boolean; text: string } | null = null) => {
  state.peer = peer;
  state.asked = [];
};
const peers = Layer.mock(BatonMemorySync)({
  history: (ask) =>
    Effect.sync(() => {
      state.asked.push(ask);
      return Option.fromNullishOr(state.peer);
    }),
});
const layer = it.layer(
  Layer.mergeAll(memoryLayer, peers).pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);
const env = { BATON_HISTORY_SEARCH: "/x/search.sh" };
const out =
  "cc828d1b  venture: shopfront  Learned the supplier needs the invoice before shipping starts\n";

layer("learnings pull", (it) => {
  it.effect("proposes quotes with their session, held for his yes, once", () =>
    Effect.gen(function* () {
      setup();
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
      setup();
      const none = yield* pullLearnings({});
      assert.include(none.why ?? "", "No server with the history index could be reached");
      assert.isFalse((yield* pullAction("status")).enabled);
      assert.isTrue((yield* pullAction("enable")).enabled);
      assert.isFalse((yield* pullAction("disable")).enabled);
    }),
  );

  it.effect(
    "without its own index, asks the paired server that holds it; a peer's ask is never passed on",
    () =>
      Effect.gen(function* () {
        setup({ found: true, text: out });
        const there = yield* searchHistory({ query: "supplier" }, {});
        assert.deepEqual(there, { ok: true, text: out });
        assert.deepEqual(state.asked, [{ query: "supplier" }]);
        // The pull lands what the peer's index found here, held for his yes.
        assert.strictEqual((yield* pullLearnings({})).why, null);
        const fromPeer = yield* searchHistory({ query: "supplier" }, {}).pipe(
          Effect.provideService(MemoryViewer, "server"),
        );
        assert.isFalse(fromPeer.ok);
        assert.lengthOf(state.asked, 1 + 4);
        // With its own index, the peers are not asked.
        yield* searchHistory({ query: "supplier" }, env, async () => out);
        assert.lengthOf(state.asked, 5);
        // A bad ask is refused here, never sent on.
        assert.deepEqual(yield* searchHistory({ query: "  " }, {}), {
          ok: false,
          why: "Say what to search for.",
        });
        assert.lengthOf(state.asked, 5);
      }),
  );

  it.effect("passes on a reached peer's own reason", () =>
    Effect.gen(function* () {
      setup({ found: false, text: "The history search did not answer." });
      assert.deepEqual(yield* searchHistory({ query: "pricing" }, {}), {
        ok: false,
        why: "The history search did not answer.",
      });
    }),
  );
});

it.effect(
  "answers without walled projects' hits, private pack text or secrets, except his own view",
  () => {
    const userdata = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "baton-history-walls-"));
    const pack = NodePath.join(userdata, "operating-system");
    NodeFS.mkdirSync(pack, { recursive: true });
    NodeFS.writeFileSync(NodePath.join(pack, "executive.md"), "---\nwalled: Shop\n---\n");
    const config = Layer.succeed(ServerConfig.ServerConfig, {
      dbPath: NodePath.join(userdata, "state.sqlite"),
    } as never);
    const private_ = "the board meets in secret on the first monday of every month";
    const hit = (project: string, text: string) =>
      `2026-10-04T13:55  user  ${project}  11111111-2222-3333-4444-555555555555\n    ${text}`;
    const index = [
      hit("-home-ann-shop", "The shop margin is twelve percent"),
      hit("-home-ann-books", `Note: ${private_}, so plan around it`),
      hit("-home-ann-books", `Use the key sk-${"b".repeat(24)} for the books export`),
      hit("-home-ann-books", "The books close on the fifth"),
    ].join("\n");
    const run = async () => index;
    return Effect.gen(function* () {
      const seen = yield* searchHistory({ query: "margin" }, env, run);
      assert.isTrue(seen.ok);
      const text = seen.ok ? seen.text : "";
      assert.notInclude(text, "margin");
      assert.notInclude(text, "board meets");
      assert.notInclude(text, "sk-b");
      assert.include(text, "[redacted: looks like a secret]");
      assert.include(text, "The books close on the fifth");
      const own = yield* searchHistory({ query: "margin", admin: true }, env, run).pipe(
        Effect.provideService(MemoryViewer, "desktop"),
      );
      assert.include(own.ok ? own.text : "", "The shop margin is twelve percent");
      assert.notInclude(own.ok ? own.text : "", "sk-b");
      // Only the desktop app's own session gets the view through walls.
      const peer = yield* searchHistory({ query: "margin", admin: true }, env, run).pipe(
        Effect.provideService(MemoryViewer, "server"),
      );
      assert.notInclude(peer.ok ? peer.text : "", "margin");
    }).pipe(
      Effect.provideService(MemoryPrivateTexts, () => [private_]),
      Effect.provide(
        Layer.mergeAll(memoryLayer, peers, config).pipe(
          Layer.provideMerge(SqlitePersistenceMemory),
        ),
      ),
      Effect.ensuring(Effect.sync(() => NodeFS.rmSync(userdata, { recursive: true, force: true }))),
    );
  },
);
