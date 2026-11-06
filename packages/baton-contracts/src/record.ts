/** The Record over the wire: one timeline of what happened, who did it, for which project. Rules: `@t3tools/baton-shared/audit`. */
import * as Schema from "effect/Schema";

export const BATON_RECORD_WS_METHODS = {
  list: "baton.record.list",
  append: "baton.record.append",
} as const;

const Line = (max: number) => Schema.String.check(Schema.isMaxLength(max));

export const BatonRecordEntry = Schema.Struct({
  id: Schema.Number,
  at: Schema.String,
  // A plain string, not literals: an older client must still decode a kind added later.
  kind: Schema.String,
  /** Who did it: a persona, the watchdog, a job's worker. */
  actor: Schema.String,
  project: Schema.NullOr(Schema.String),
  /** The id a tool needs to act on it (a session, a job, a weave). */
  ref: Schema.NullOr(Schema.String),
  subject: Schema.String,
  outcome: Schema.String,
  detail: Schema.String,
});
export type BatonRecordEntry = typeof BatonRecordEntry.Type;

export const BatonRecordListInput = Schema.Struct({
  /** ISO time; only what happened after it. */
  since: Schema.optionalKey(Schema.String),
  project: Schema.optionalKey(Line(200)),
  limit: Schema.optionalKey(Schema.Number.check(Schema.isBetween({ minimum: 1, maximum: 500 }))),
});
export const BatonRecordListResult = Schema.Struct({ entries: Schema.Array(BatonRecordEntry) });

/** What a client may write: its own assistant's turns and his answers at its gate, stored as `approval_reported_by_client`. The server writes every other kind itself. */
export const BatonRecordAppendInput = Schema.Struct({
  kind: Schema.Literals(["assistant_turn", "approval"]),
  actor: Line(60),
  project: Schema.optionalKey(Line(200)),
  subject: Line(300),
  outcome: Schema.Literals(["answered", "failed", "approved", "declined"]),
  detail: Line(1000),
});
export const BatonRecordAppendResult = Schema.Struct({});
