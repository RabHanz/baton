import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { layerMemory as SqlitePersistenceMemory } from "./BatonDatabase.ts";
import { AdoptedSessionService } from "./AdoptedSessionService.ts";
import { BatonWeaveService, layer as weaveLayer } from "./BatonWeaveService.ts";

/** One pane, whose screen and state the test sets, and a record of what was typed. */
const pane = { state: "idle", screen: "work\n│ > │", typed: [] as string[] };

const fakeAdopted = Layer.succeed(AdoptedSessionService, {
  discover: Effect.sync(() => ({
    available: true,
    reason: "",
    candidates: [
      {
        runtime: "herdr",
        label: "build",
        location: { workspace: "w", pane: "p1", host: null },
        agentKind: "claude",
        runtimeState: pane.state,
      },
    ],
  })),
  register: (input: { id: string }) => Effect.succeed({ id: input.id }),
  readOutput: () => Effect.sync(() => ({ available: true, detail: "", output: pane.screen })),
  sendInput: (input: { text: string }) =>
    Effect.sync(() => {
      pane.typed.push(input.text);
      return { delivered: true, detail: "" };
    }),
} as never);

const layer = it.layer(
  weaveLayer.pipe(Layer.provideMerge(fakeAdopted), Layer.provideMerge(SqlitePersistenceMemory)),
);

layer("BatonWeaveService", (it) => {
  it.effect("delivers into an empty input, then reads the reply once it is idle", () =>
    Effect.gen(function* () {
      const weave = yield* BatonWeaveService;
      pane.typed.length = 0;
      pane.state = "idle";
      pane.screen = "work\n│ > │";
      const sent = yield* weave.send({ to: "build", text: "please rerun the tests", job: "j1" });
      assert.strictEqual(sent.status, "delivered");
      assert.deepStrictEqual(pane.typed, ["please rerun the tests"]);
      pane.screen = "│ > please rerun the tests │\n● All 40 pass.\n│ > │";
      const ticked = yield* weave.tick;
      assert.strictEqual(ticked.replied, 1);
      const [row] = yield* weave.list();
      assert.strictEqual(row?.status, "replied");
      assert.strictEqual(row?.reply, "● All 40 pass.");
    }),
  );

  it.effect("keeps a message queued while a draft is in the box, and never types over it", () =>
    Effect.gen(function* () {
      const weave = yield* BatonWeaveService;
      pane.typed.length = 0;
      pane.screen = "│ > half a sentence │";
      const sent = yield* weave.send({ to: "build", text: "second message here" });
      assert.strictEqual(sent.status, "queued");
      assert.include(sent.reason ?? "", "draft");
      assert.deepStrictEqual(pane.typed, []);
      pane.screen = "│ > │";
      assert.strictEqual((yield* weave.tick).delivered, 1);
      assert.deepStrictEqual(pane.typed, ["second message here"]);
    }),
  );

  it.effect("refuses a secret and an unknown session in plain words", () =>
    Effect.gen(function* () {
      const weave = yield* BatonWeaveService;
      const secret = yield* Effect.flip(weave.send({ to: "build", text: "my password is hunter22x" }));
      assert.include(secret.reason, "password");
      const none = yield* Effect.flip(weave.send({ to: "ghost", text: "hello there friend" }));
      assert.include(none.reason, "no session");
    }),
  );
});
