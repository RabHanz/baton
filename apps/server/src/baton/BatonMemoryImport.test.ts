// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { layerMemory as SqlitePersistenceMemory } from "./BatonDatabase.ts";
import { importFolder } from "./BatonMemoryImport.ts";
import { BatonMemoryService, layer as memoryLayer } from "./BatonMemoryService.ts";

const layer = it.layer(memoryLayer.pipe(Layer.provideMerge(SqlitePersistenceMemory)));

layer("importFolder", (it) => {
  it.effect("imports learnings once, skips unchanged files, refuses secrets, never writes", () =>
    Effect.gen(function* () {
      const memory = yield* BatonMemoryService;
      const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "baton-import-"));
      NodeFS.mkdirSync(NodePath.join(dir, "shop"));
      NodeFS.writeFileSync(
        NodePath.join(dir, "shop", "a.md"),
        "---\nkind: learning\nproject: shop\n---\n- Retry the upload once\n- my password is hunter22x\n",
      );
      NodeFS.writeFileSync(NodePath.join(dir, "b.md"), "# Notes\nKeep the cache warm.\n");
      NodeFS.writeFileSync(NodePath.join(dir, "ignore.txt"), "not markdown");
      const before = NodeFS.readFileSync(NodePath.join(dir, "b.md"), "utf8");

      const first = yield* importFolder(dir);
      assert.deepEqual(first, { files: 2, added: 2, refused: 1, unchanged: 0 });
      const found = yield* memory.search({ text: "upload", scopeRef: "shop" });
      assert.strictEqual(found[0]?.item.source, "import");
      assert.strictEqual(found[0]?.item.sourceRef, "shop/a.md");

      const again = yield* importFolder(dir);
      assert.deepEqual(again, { files: 2, added: 0, refused: 0, unchanged: 2 });
      assert.strictEqual(NodeFS.readFileSync(NodePath.join(dir, "b.md"), "utf8"), before);
      NodeFS.rmSync(dir, { recursive: true, force: true });

      const missing = yield* Effect.flip(importFolder(dir));
      assert.include(missing.reason, "cannot be read");
      const relative = yield* Effect.flip(importFolder("shop"));
      assert.include(relative.reason, "full path");
    }),
  );
});
