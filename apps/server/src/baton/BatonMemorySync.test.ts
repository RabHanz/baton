import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ServerSecretStore } from "../auth/ServerSecretStore.ts";
import { layerMemory as SqlitePersistenceMemory } from "./BatonDatabase.ts";
import { BatonMemoryService } from "./BatonMemoryService.ts";
import {
  BatonMemorySync,
  layer,
  peerUrl,
  syncRound,
  type SyncEndpoint,
} from "./BatonMemorySync.ts";

/** A server holding its own changes by time, and the newest change it has applied from each peer. */
const server = (id: string, origin: string) => {
  const own: Array<{ readonly at: string }> = [];
  const applied: Record<string, string> = {};
  const endpoint: SyncEndpoint = {
    id,
    hello: Effect.sync(() => Option.some({ origin, cursors: { ...applied } })),
    pull: (since) =>
      Effect.sync(() =>
        Option.some({
          origin,
          changes: own.filter((c) => since === null || c.at > since) as never,
          upTo: own.at(-1)?.at ?? "",
        }),
      ),
    push: (input) =>
      Effect.sync(() => {
        if (input.upTo !== "") applied[input.from] = input.upTo;
        return Option.some(input.changes.length);
      }),
  };
  return { endpoint, own, applied };
};
const change = (at: string) => ({ at });

it.effect(
  "carries each server's changes to every other once, from the cursor it holds, and counts one server once",
  () =>
    Effect.gen(function* () {
      const here = server("self", "https://laptop");
      const box = server("box", "https://box");
      const sameBox = server("box-again", "https://box");
      box.own.push(change("2026-11-07T10:00:00Z"), change("2026-11-07T11:00:00Z"));
      here.own.push(change("2026-11-07T10:30:00Z"));
      const first = yield* syncRound([here.endpoint, box.endpoint, sameBox.endpoint]);
      assert.deepStrictEqual(first, { servers: 2, applied: 3 });
      assert.strictEqual(here.applied["https://box"], "2026-11-07T11:00:00Z");
      // The cursor holds: nothing new from the box is carried again.
      const second = yield* syncRound([here.endpoint, box.endpoint]);
      assert.strictEqual(second.applied, 0);
    }),
);

it("sends a credential only to the origin that issued it", () => {
  assert.strictEqual(
    peerUrl("https://box.example:8443", "baton.memory.syncPull")?.href,
    "https://box.example:8443/tessaya/desk/baton.memory.syncPull",
  );
  assert.isNull(peerUrl("not a url", "baton.memory.syncPull"));
});

const stored = new Map<string, Uint8Array>();
const secrets = Layer.mock(ServerSecretStore)({
  get: (name) => Effect.sync(() => Option.fromNullishOr(stored.get(name))),
  set: (name, value) => Effect.sync(() => void stored.set(name, value)),
});
const memory = Layer.mock(BatonMemoryService)({
  origin: "https://laptop",
  syncHello: Effect.succeed({ origin: "https://laptop", cursors: {} }),
});

it.effect("keeps a peer's credential in the secret store, and shows it without its token", () =>
  Effect.gen(function* () {
    const sync = yield* BatonMemorySync;
    yield* sync.addPeer({
      environmentId: "box",
      label: "Server",
      origin: "https://box.example",
      token: "sync-token",
      expiresAt: 10_000,
    });
    yield* sync.setEnabled(true);
    const state = yield* sync.state;
    assert.deepStrictEqual(state, {
      enabled: true,
      peers: [{ environmentId: "box", label: "Server", expiresAt: 10_000 }],
    });
    assert.include(new TextDecoder().decode(stored.get("tessaya-memory-sync-peers")), "sync-token");
    yield* sync.forget("box");
    assert.deepStrictEqual((yield* sync.state).peers, []);
  }).pipe(
    Effect.provide(
      layer.pipe(
        Layer.provide(Layer.mergeAll(secrets, memory)),
        Layer.provideMerge(SqlitePersistenceMemory),
      ),
    ),
  ),
);
