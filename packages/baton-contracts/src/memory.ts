/**
 * Memory over the wire (D150, docs/baton/MEMORY.md). The same shapes as `MemoryItem` in
 * `@t3tools/baton-shared/memory`; the server checks they stay assignable.
 */
import * as Schema from "effect/Schema";

import { IsoDateTime, TrimmedNonEmptyString } from "@t3tools/contracts";

export const BATON_MEMORY_WS_METHODS = {
  list: "baton.memory.list",
  search: "baton.memory.search",
  add: "baton.memory.add",
  edit: "baton.memory.edit",
  pin: "baton.memory.pin",
  forget: "baton.memory.forget",
  accept: "baton.memory.accept",
  recall: "baton.memory.recall",
  used: "baton.memory.used",
  export: "baton.memory.export",
  learn: "baton.memory.learn",
} as const;

export const BatonMemoryKind = Schema.Literals([
  "note",
  "preference",
  "fact",
  "decision",
  "correction",
  "episode",
  "learning",
]);
export const BatonMemorySource = Schema.Literals(["user", "thread", "job", "import", "sync"]);
export const BatonMemoryScope = Schema.Literals(["global", "project", "person"]);

export const BatonMemoryItem = Schema.Struct({
  id: TrimmedNonEmptyString,
  kind: BatonMemoryKind,
  text: TrimmedNonEmptyString,
  source: BatonMemorySource,
  sourceRef: Schema.NullOr(Schema.String),
  scope: BatonMemoryScope,
  scopeRef: Schema.NullOr(Schema.String),
  confidence: Schema.Number,
  pinned: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  lastUsedAt: Schema.NullOr(IsoDateTime),
  expiresAt: Schema.NullOr(IsoDateTime),
  supersededBy: Schema.NullOr(Schema.String),
  proposed: Schema.Boolean,
});
export type BatonMemoryItem = typeof BatonMemoryItem.Type;

export const BatonMemoryQuery = Schema.Struct({
  text: Schema.optionalKey(Schema.String),
  kinds: Schema.optionalKey(Schema.Array(BatonMemoryKind)),
  scope: Schema.optionalKey(BatonMemoryScope),
  scopeRef: Schema.optionalKey(Schema.NullOr(Schema.String)),
  includeSuperseded: Schema.optionalKey(Schema.Boolean),
  includeProposed: Schema.optionalKey(Schema.Boolean),
  limit: Schema.optionalKey(Schema.Number),
});
export type BatonMemoryQuery = typeof BatonMemoryQuery.Type;

export const BatonMemoryDraft = Schema.Struct({
  kind: BatonMemoryKind,
  text: Schema.String,
  source: BatonMemorySource,
  sourceRef: Schema.optionalKey(Schema.NullOr(Schema.String)),
  scope: Schema.optionalKey(BatonMemoryScope),
  scopeRef: Schema.optionalKey(Schema.NullOr(Schema.String)),
  confidence: Schema.optionalKey(Schema.Number),
  pinned: Schema.optionalKey(Schema.Boolean),
  expiresAt: Schema.optionalKey(Schema.NullOr(IsoDateTime)),
  tainted: Schema.optionalKey(Schema.Boolean),
  /** The id this one replaces; the old item stays as history. */
  supersedes: Schema.optionalKey(Schema.String),
});
export type BatonMemoryDraft = typeof BatonMemoryDraft.Type;

export const BatonMemoryItemResult = Schema.Struct({ item: BatonMemoryItem });
export const BatonMemoryListResult = Schema.Struct({ items: Schema.Array(BatonMemoryItem) });
export const BatonMemorySearchResult = Schema.Struct({
  hits: Schema.Array(Schema.Struct({ item: BatonMemoryItem, score: Schema.Number })),
});
export const BatonMemoryEditInput = Schema.Struct({
  id: TrimmedNonEmptyString,
  text: Schema.optionalKey(Schema.String),
  kind: Schema.optionalKey(BatonMemoryKind),
});
export const BatonMemoryPinInput = Schema.Struct({
  id: TrimmedNonEmptyString,
  pinned: Schema.Boolean,
});
export const BatonMemoryRefInput = Schema.Struct({ id: TrimmedNonEmptyString });
export const BatonMemoryForgetResult = Schema.Struct({ forgotten: Schema.Boolean });
export const BatonMemoryRecallInput = Schema.Struct({
  text: Schema.optionalKey(Schema.String),
  scopeRef: Schema.optionalKey(Schema.NullOr(Schema.String)),
  budgetTokens: Schema.optionalKey(Schema.Number),
  /** The turn the memories are for, so "what did you use?" has an answer. */
  turnRef: Schema.optionalKey(Schema.String),
});
export const BatonMemoryRecallResult = Schema.Struct({
  block: Schema.String,
  ids: Schema.Array(Schema.String),
});
export const BatonMemoryUsedInput = Schema.Struct({ turnRef: TrimmedNonEmptyString });
export const BatonMemoryExportResult = Schema.Struct({ markdown: Schema.String });

/** Said in plain words to him: "that looks like a password, so I did not keep it". */
export class BatonMemoryRefusedError extends Schema.TaggedError<BatonMemoryRefusedError>()(
  "BatonMemoryRefusedError",
  { reason: Schema.String },
) {
  override get message(): string {
    return this.reason;
  }
}

/** After a turn: what he said and what came back, for the extractor (D150). Dictation is never sent. */
export const BatonMemoryLearnInput = Schema.Struct({
  said: Schema.String,
  reply: Schema.String,
  /** The turn read something from outside, so nothing from it is kept without his yes. */
  tainted: Schema.Boolean,
  project: Schema.optionalKey(Schema.NullOr(Schema.String)),
  turnRef: Schema.optionalKey(Schema.String),
});
export const BatonMemoryLearnResult = Schema.Struct({
  stored: Schema.Number,
  held: Schema.Number,
});
