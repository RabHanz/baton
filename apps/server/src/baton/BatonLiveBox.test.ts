// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import type { ClaudeLiveSession } from "@t3tools/baton-contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { layerMemory as SqlitePersistenceMemory } from "./BatonDatabase.ts";
import { BatonWeaveBoxes, makeLiveBox } from "./BatonWeaveBoxes.ts";
import { BatonWeaveService, layer as weaveLayer } from "./BatonWeaveService.ts";

const session = (sessionId: string, name: string, herdrPane: string | null) =>
  ({ pid: 1, sessionId, cwd: "/w/x", name, status: "idle", herdrPane }) as unknown as ClaudeLiveSession;

const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "weave-live-"));
const live = makeLiveBox(
  Effect.succeed([session("sid-1", "plain", null), session("sid-2", "paned", "p1"), session("sid-3", "sender", null)]),
  () => dir,
);

const layer = it.layer(
  weaveLayer.pipe(
    Layer.provideMerge(Layer.succeed(BatonWeaveBoxes, [live])),
    Layer.provideMerge(SqlitePersistenceMemory),
  ),
);

const queued = (id: string): Array<{ text: string; kind?: string }> =>
  JSON.parse(NodeFS.readFileSync(NodePath.join(dir, `${id}.json`), "utf8"));

layer("weaving to live threads outside Herdr", (it) => {
  it.effect("queues for the session and notes the sender's thread", () =>
    Effect.gen(function* () {
      const weave = yield* BatonWeaveService;
      const sent = yield* weave.send({ to: "plain", text: "please look at the build", from: "sender" });
      assert.strictEqual(sent.status, "delivered");
      assert.deepStrictEqual(queued("sid-1").map((i) => i.text), ["please look at the build"]);
      const [note] = queued("sid-3");
      assert.strictEqual(note?.kind, "note");
      assert.match(note?.text ?? "", /^Sent to live:plain/);
    }),
  );

  it.effect("a session already in a pane is not offered here", () =>
    Effect.gen(function* () {
      const weave = yield* BatonWeaveService;
      const result = yield* weave.send({ to: "paned", text: "hello there" }).pipe(Effect.flip);
      assert.match(result.reason, /no session is called/);
    }),
  );
});
