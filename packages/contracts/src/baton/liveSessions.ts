/**
 * Every Claude Code session running on an environment, whoever started it (D68).
 *
 * Claude Code writes `<config dir>/sessions/<pid>.json` for each live process:
 * its conversation id, directory, name, busy/idle status and where it runs
 * (a terminal, VS Code, tmux). Baton reads those, so a session started in a
 * plain terminal or in VS Code is in the same list as a T3 thread or a Herdr
 * pane, and none of it depends on which account is signed in.
 *
 * @module baton/liveSessions
 */
import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "../baseSchemas.ts";

// Legacy names (D71): wire method names keep "fabric." so installed clients keep working.
export const BATON_LIVE_WS_METHODS = {
  /** Type into a Herdr pane by its ref; refused unless discovery currently sees that pane. */
  herdrSend: "fabric.herdr.send",
} as const;

export const ClaudeLiveSession = Schema.Struct({
  pid: Schema.Number,
  sessionId: TrimmedNonEmptyString,
  cwd: TrimmedNonEmptyString,
  name: Schema.NullOr(Schema.String),
  /** Claude Code's own word: "busy", "idle", or another it adds later. */
  status: Schema.NullOr(Schema.String),
  /** "cli", "vscode", … as Claude Code reports its entrypoint. */
  entrypoint: Schema.NullOr(Schema.String),
  /** The Herdr pane ref (`<session>~<pane>`, or the pane alone in the default session). */
  herdrPane: Schema.NullOr(Schema.String),
  tmux: Schema.NullOr(Schema.String),
  /** The account behind its config directory, when the pool knows it. */
  account: Schema.NullOr(Schema.String),
  updatedAt: Schema.NullOr(Schema.String),
});
export type ClaudeLiveSession = typeof ClaudeLiveSession.Type;

export const BatonHerdrSendInput = Schema.Struct({
  pane: TrimmedNonEmptyString,
  text: Schema.String.check(Schema.isNonEmpty()).check(Schema.isMaxLength(65_536)),
  submit: Schema.optionalKey(Schema.Boolean),
});
export type BatonHerdrSendInput = typeof BatonHerdrSendInput.Type;

export const BatonHerdrSendResult = Schema.Struct({
  delivered: Schema.Boolean,
  detail: Schema.String,
});
export type BatonHerdrSendResult = typeof BatonHerdrSendResult.Type;
