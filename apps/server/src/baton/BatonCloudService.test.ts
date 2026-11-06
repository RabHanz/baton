// @effect-diagnostics nodeBuiltinImport:off
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import { BatonCloudService, layer } from "./BatonCloudService.ts";
import { BatonRecordService, type RecordAppend } from "./BatonRecordService.ts";

const config = Layer.succeed(ServerConfig.ServerConfig, {
  dbPath: NodePath.join(NodeOS.tmpdir(), "baton-cloud-test", "state.sqlite"),
} as never);

const rows: RecordAppend[] = [];
const record = Layer.succeed(BatonRecordService, {
  append: (entry) => Effect.sync(() => void rows.push(entry)),
  appendFromClient: () => Effect.void,
  query: () => Effect.succeed([]),
});

it.layer(layer.pipe(Layer.provide(config), Layer.provide(record)))("BatonCloudService", (it) => {
  it.effect("keeps the read door to reads and the act door to changes", () =>
    Effect.gen(function* () {
      const cloud = yield* BatonCloudService;
      const refused = { ok: false, error: "That request is not allowed here." };
      assert.deepStrictEqual(
        yield* cloud.call({ op: "approve", provider: "claude", args: {} }, "read"),
        refused,
      );
      assert.deepStrictEqual(
        yield* cloud.call({ op: "dispatch", provider: "claude", args: {} }, "read"),
        refused,
      );
      assert.deepStrictEqual(
        yield* cloud.call({ op: "status", provider: "claude", args: {} }, "act"),
        refused,
      );
      assert.deepStrictEqual(yield* cloud.call({ op: "rm -rf" }, "act"), refused);
    }),
  );

  it.effect("keeps approve and deny to their own door, away from the act door", () =>
    Effect.gen(function* () {
      const cloud = yield* BatonCloudService;
      const refused = { ok: false, error: "That request is not allowed here." };
      assert.deepStrictEqual(
        yield* cloud.call({ op: "approve", provider: "claude", args: {} }, "act"),
        refused,
      );
      assert.deepStrictEqual(
        yield* cloud.call({ op: "deny", provider: "claude", args: {} }, "act"),
        refused,
      );
      assert.deepStrictEqual(
        yield* cloud.call({ op: "dispatch", provider: "claude", args: {} }, "approve"),
        refused,
      );
      assert.deepStrictEqual(
        yield* cloud.call({ op: "approve", provider: "gemini", args: {} }, "approve"),
        {
          ok: false,
          error: "That cloud provider is not set up on the computer that runs cloud tasks.",
        },
      );
    }),
  );

  it.effect("says plainly when the hub does not have the provider", () =>
    Effect.gen(function* () {
      const cloud = yield* BatonCloudService;
      const out = yield* cloud.call(
        { op: "dispatch", provider: "gemini", args: { repo: "o/r", branch: "b", brief: "x" } },
        "act",
      );
      assert.deepStrictEqual(out, {
        ok: false,
        error: "That cloud provider is not set up on the computer that runs cloud tasks.",
      });
    }),
  );

  it.effect("writes each decision on a cloud task to the Record, and never a read", () =>
    Effect.gen(function* () {
      const cloud = yield* BatonCloudService;
      rows.length = 0;
      yield* cloud.call({ op: "status", provider: "claude", args: { id: "t1" } }, "read");
      yield* cloud.call(
        { op: "approve", provider: "gemini", args: { id: "t1", repo: "acme/app" } },
        "approve",
      );
      assert.deepStrictEqual(rows, [
        {
          kind: "cloud",
          actor: "him",
          project: "acme/app",
          ref: "t1",
          subject: "approve on gemini",
          outcome: "failed",
          detail: "That cloud provider is not set up on the computer that runs cloud tasks.",
        },
      ]);
    }),
  );
});
