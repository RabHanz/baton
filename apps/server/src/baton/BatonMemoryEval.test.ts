/* oxlint-disable t3code/no-test-in-loop -- Baton file predating the rule (D82) */
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
  readonly items: ReadonlyArray<
    Omit<MemoryDraft, "supersedes"> & { key: string; supersedes?: string }
  >;
  readonly cases: ReadonlyArray<{
    /** Ask for the per-sentence block the model gets (the desktop's budget), not a search. */
    readonly recall?: boolean;
    /** Known to fail until this finding lands; the run fails once it passes, so the mark is dropped. */
    readonly pending?: string;
    readonly query: string;
    readonly scopeRef?: string;
    readonly top?: string;
    readonly present?: ReadonlyArray<string>;
    readonly absent?: ReadonlyArray<string>;
    readonly count?: number;
  }>;
}

const dir = NodePath.join(import.meta.dirname, "../../../../docs/baton/evals-memory");
const files = NodeFS.readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .toSorted();
const corpora = files.map(
  (f) => [f, JSON.parse(NodeFS.readFileSync(NodePath.join(dir, f), "utf8")) as Corpus] as const,
);

it.effect("there are at least twenty retrieval cases", () =>
  Effect.sync(() =>
    assert.isAtLeast(
      corpora.reduce((n, [, c]) => n + c.cases.length, 0),
      20,
    ),
  ),
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
        const scope = c.scopeRef === undefined ? {} : { scopeRef: c.scopeRef };
        const ids = c.recall
          ? (yield* memory.recall({ text: c.query, budgetTokens: 300, ...scope })).ids
          : (yield* memory.search({ text: c.query, ...scope })).map((h) => h.item.id);
        const keys = ids.map((id) => keyOf.get(id) ?? id);
        const say = `"${c.query}" gave ${JSON.stringify(keys)}`;
        const check = () => {
          if (c.top !== undefined) assert.strictEqual(keys[0], c.top, say);
          for (const k of c.present ?? []) assert.include(keys, k, say);
          for (const k of c.absent ?? []) assert.notInclude(keys, k, say);
          if (c.count !== undefined) assert.lengthOf(keys, c.count, say);
        };
        if (c.pending === undefined) check();
        else assert.throws(check, undefined, undefined, `${say}: passes now, drop "pending"`);
      }
    }).pipe(Effect.provide(memoryLayer.pipe(Layer.provideMerge(SqlitePersistenceMemory)))),
  );
}
