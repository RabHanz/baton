/**
 * Every Claude session on a machine, running or stopped, in any folder and under any account, and the
 * actions that bring one back: resume in Herdr, send (which resumes first), start a new one. One set of
 * methods per environment; the client asks each connected environment and adds its name. Plain JSON.
 */
import * as Schema from "effect/Schema";

export const BATON_SESSIONS_WS_METHODS = {
  list: "baton.sessions.list",
  folders: "baton.sessions.folders",
  resume: "baton.sessions.resume",
  create: "baton.sessions.create",
  send: "baton.sessions.send",
} as const;

export const BatonCatalogState = Schema.Literals(["running", "stopped", "resuming", "failed"]);
export type BatonCatalogState = typeof BatonCatalogState.Type;

export const BatonCatalogSession = Schema.Struct({
  /** The Claude session id. */
  id: Schema.String,
  /** The machine's own name; the client shows the environment's label. */
  machine: Schema.String,
  project: Schema.String,
  cwd: Schema.NullOr(Schema.String),
  title: Schema.String,
  lastActivityAt: Schema.NullOr(Schema.String),
  account: Schema.NullOr(Schema.String),
  state: BatonCatalogState,
  /** Running now, a transcript on this machine, or only found in the history index. */
  source: Schema.Literals(["live", "transcript", "history"]),
  canResume: Schema.Boolean,
  /** Plain words: why it cannot be resumed, or why it failed. */
  detail: Schema.NullOr(Schema.String),
  /** Messages waiting for it to be ready. */
  waiting: Schema.Number,
});
export type BatonCatalogSession = typeof BatonCatalogSession.Type;

export const BatonCatalogListInput = Schema.Struct({
  query: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(200))),
  limit: Schema.optionalKey(Schema.Number),
  /** Rows older than this ISO time: the next page. */
  before: Schema.optionalKey(Schema.String),
});
export const BatonCatalogListResult = Schema.Struct({
  machine: Schema.String,
  sessions: Schema.Array(BatonCatalogSession),
  more: Schema.Boolean,
});

export const BatonCatalogFoldersInput = Schema.Struct({
  query: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(200))),
});
export const BatonCatalogFoldersResult = Schema.Struct({
  folders: Schema.Array(
    Schema.Struct({
      cwd: Schema.String,
      project: Schema.String,
      lastActivityAt: Schema.NullOr(Schema.String),
    }),
  ),
});

export const BatonCatalogResumeInput = Schema.Struct({
  sessionId: Schema.String.check(Schema.isMaxLength(80)),
  cwd: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(500))),
});
export const BatonCatalogResumeResult = Schema.Struct({
  state: BatonCatalogState,
  pane: Schema.NullOr(Schema.String),
  detail: Schema.NullOr(Schema.String),
  /** Set when the session came back as a T3 thread (a machine with no Herdr, such as Windows). */
  threadId: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

export const BatonCatalogCreateInput = Schema.Struct({
  cwd: Schema.String.check(Schema.isMaxLength(500)),
  agent: Schema.optionalKey(Schema.Literal("claude")),
});
export const BatonCatalogCreateResult = Schema.Struct({
  state: BatonCatalogState,
  sessionId: Schema.NullOr(Schema.String),
  pane: Schema.NullOr(Schema.String),
  detail: Schema.NullOr(Schema.String),
});

export const BatonCatalogSendInput = Schema.Struct({
  sessionId: Schema.String.check(Schema.isMaxLength(80)),
  text: Schema.String.check(Schema.isNonEmpty()).check(Schema.isMaxLength(65_536)),
  cwd: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(500))),
});
export const BatonCatalogSendResult = Schema.Struct({
  /** "running" when it was delivered; "resuming" while it comes back; "failed" with the reason (the message is kept). */
  state: BatonCatalogState,
  delivered: Schema.Boolean,
  detail: Schema.NullOr(Schema.String),
});
