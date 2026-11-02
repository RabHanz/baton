// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type { MemoryDraft } from "@t3tools/baton-shared/memory";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { layerMemory as SqlitePersistenceMemory } from "./BatonDatabase.ts";
import { BatonMemoryService, layer as memoryLayer } from "./BatonMemoryService.ts";

/** docs/baton/evals-memory/*.json: what is remembered, then what a question should bring back first. */
interface Corpus {
  readonly items: ReadonlyArray<Omit<MemoryDraft, "supersedes"> & { key: string; supersedes?: string }>;
  readonly cases: ReadonlyArray<{
    readonly query: string;
    readonly scopeRef?: string;
    readonly top?: string;
    readonly present?: ReadonlyArray<string>;
    readonly absent?: ReadonlyArray<string>;
    readonly count?: number;
  }>;
}

const dir = NodePath.join(import.meta.dirname, "../../../../docs/baton/evals-memory");
const files = NodeFS.readdirSync(dir).filter((f) => f.endsWith(".json")).toSorted();
const corpora = files.map((f) => [f, JSON.parse(NodeFS.readFileSync(NodePath.join(dir, f), "utf8")) as Corpus] as const);

it.effect("there are at least twenty retrieval cases", () =>
  Effect.sync(() => assert.isAtLeast(corpora.reduce((n, [, c]) => n + c.cases.length, 0), 20)),
);

for (const [file, corpus] of corpora) {
  it.effect(`retrieval: ${file}`, () =>
    Effect.gen(function* () {
      const memory = yield* BatonMemoryService;
      const keyOf = new Map<string, string>();
      const idOf = new Map<string, string>();
      for (const { key, supersedes, ...draft } of corpus.items) {
        const made = yield* memory.add({
          ...draft,
          ...(supersedes === undefined ? {} : { supersedes: idOf.get(supersedes)! }),
        });
        idOf.set(key, made.id);
        if (!keyOf.has(made.id)) keyOf.set(made.id, key);
      }
      for (const c of corpus.cases) {
        const hits = yield* memory.search({
          text: c.query,
          ...(c.scopeRef === undefined ? {} : { scopeRef: c.scopeRef }),
        });
        const keys = hits.map((h) => keyOf.get(h.item.id) ?? h.item.text);
        const say = `"${c.query}" gave ${JSON.stringify(keys)}`;
        if (c.top !== undefined) assert.strictEqual(keys[0], c.top, say);
        for (const k of c.present ?? []) assert.include(keys, k, say);
        for (const k of c.absent ?? []) assert.notInclude(keys, k, say);
        if (c.count !== undefined) assert.lengthOf(keys, c.count, say);
      }
    }).pipe(Effect.provide(memoryLayer.pipe(Layer.provideMerge(SqlitePersistenceMemory)))),
  );
}
