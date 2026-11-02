// @effect-diagnostics nodeBuiltinImport:off
/**
 * The learning loop (D150, docs/baton/MEMORY.md section 4): after a turn and at the end of a job a
 * cheap model proposes memory items; the pure rules decide which become drafts and the store's door
 * decides which are kept. A failure here never reaches the user: learning is a bonus, never a gate.
 */
import { modelFor } from "@t3tools/baton-shared/costRouting";
import { similarity } from "@t3tools/baton-shared/memory";
import {
  draftsFromProposals,
  extractionPrompt,
  planMerges,
  planRewrites,
  worthLearningFrom,
  type LearnInput,
} from "@t3tools/baton-shared/memoryLearning";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as NodePath from "node:path";

import * as ServerConfig from "../config.ts";
import { BatonOneShot } from "./BatonOneShot.ts";
import { dayOf } from "./BatonMemoryEpisode.ts";
import { BatonMemoryService } from "./BatonMemoryService.ts";
import { readRouting } from "./OperatingSystemPack.ts";

const Proposals = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({
      kind: Schema.String,
      text: Schema.String,
      scope: Schema.optionalKey(Schema.String),
      scopeRef: Schema.optionalKey(Schema.NullOr(Schema.String)),
      hisStatement: Schema.optionalKey(Schema.Boolean),
      contradicts: Schema.optionalKey(Schema.NullOr(Schema.String)),
      days: Schema.optionalKey(Schema.NullOr(Schema.Number)),
    }),
  ),
});

/** A hit this close to the "contradicts" words is the belief being replaced. */
const REPLACES_OVERLAP = 0.4;

export interface LearnResult {
  readonly stored: number;
  readonly held: number;
}

export class BatonMemoryLearning extends Context.Service<
  BatonMemoryLearning,
  {
    readonly learn: (input: LearnInput) => Effect.Effect<LearnResult>;
    /** The daily pass: merge near-duplicates, then delete what expired or faded. */
    readonly consolidate: Effect.Effect<{ readonly merged: number; readonly swept: number }>;
    /** The weekly pass: near-duplicates become one item with the fuller wording. */
    readonly rewriteNearDuplicates: Effect.Effect<number>;
  }
>()("t3/baton/BatonMemoryLearning") {}

export const make = Effect.gen(function* () {
  const memory = yield* BatonMemoryService;
  const oneShot = yield* BatonOneShot;
  const config = yield* ServerConfig.ServerConfig;

  const learn = Effect.fn("BatonMemoryLearning.learn")(function* (input: LearnInput) {
    const none: LearnResult = { stored: 0, held: 0 };
    if (input.origin === "turn" && input.said.trim() !== "") {
      yield* memory.noteTalk(dayOf(yield* Clock.currentTimeMillis), input.said);
    }
    if (!worthLearningFrom(input)) return none;
    const proposals = yield* oneShot
      .run({
        prompt: extractionPrompt(input),
        outputSchema: Proposals,
        model: modelFor("routine", readRouting(NodePath.dirname(config.dbPath))),
      })
      .pipe(Effect.orElseSucceed(() => ({ items: [] })));
    const drafts = draftsFromProposals(proposals.items, input, yield* Clock.currentTimeMillis);
    let stored = 0;
    let held = 0;
    for (const { draft, contradicts } of drafts) {
      const older =
        contradicts === null
          ? undefined
          : (yield* memory.search({ text: contradicts, limit: 3 })).find(
              (hit) => similarity(hit.item.text, contradicts) >= REPLACES_OVERLAP,
            );
      const item = yield* memory
        .add({ ...draft, ...(older === undefined ? {} : { supersedes: older.item.id }) })
        .pipe(Effect.orElseSucceed(() => null));
      if (item === null) continue;
      if (item.proposed) held++;
      else stored++;
    }
    return { stored, held };
  });

  const consolidate = Effect.gen(function* () {
    const all = yield* memory.list({
      includeSuperseded: true,
      includeProposed: true,
      limit: 100_000,
    });
    const plans = planMerges(all);
    for (const { keep, drop } of plans) {
      // Saying it twice is repetition: re-adding the survivor reinforces it (MEMORY.md section 2).
      yield* memory
        .add({
          kind: keep.kind,
          text: keep.text,
          source: keep.source,
          sourceRef: keep.sourceRef,
          scope: keep.scope,
          scopeRef: keep.scopeRef,
        })
        .pipe(Effect.ignore);
      yield* memory.forget(drop.id);
    }
    return { merged: plans.length, swept: yield* memory.sweep };
  });

  const rewriteNearDuplicates = Effect.gen(function* () {
    const all = yield* memory.list({ includeSuperseded: true, limit: 100_000 });
    let done = 0;
    for (const { keep, drop, text } of planRewrites(all)) {
      if (text !== keep.text) yield* memory.rewrite(keep.id, text).pipe(Effect.ignore);
      yield* memory.forget(drop.id);
      done++;
    }
    return done;
  });

  return BatonMemoryLearning.of({ learn, consolidate, rewriteNearDuplicates });
});

export const layer = Layer.effect(BatonMemoryLearning, make);
