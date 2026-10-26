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
  /** Put a file into a live session's directory and return its path (D73). */
  liveAttach: "baton.live.attach",
  /** Bring a Claude session from a plain terminal or VS Code into Herdr, same conversation (D74). */
  liveAdopt: "baton.live.adopt",
} as const;

/** Where a live session is: a Herdr pane, or a Claude conversation by id. */
export const BatonLiveTarget = Schema.Struct({
  pane: Schema.optionalKey(TrimmedNonEmptyString),
  sessionId: Schema.optionalKey(TrimmedNonEmptyString),
});
export type BatonLiveTarget = typeof BatonLiveTarget.Type;

/** 8 MiB of file, base64-encoded on the wire. */
export const BATON_ATTACH_MAX_BYTES = 8 * 1024 * 1024;

export const BatonLiveAttachInput = Schema.Struct({
  target: BatonLiveTarget,
  fileName: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  dataBase64: Schema.String.check(
    Schema.isMaxLength(Math.ceil((BATON_ATTACH_MAX_BYTES * 4) / 3) + 4),
  ),
});
export type BatonLiveAttachInput = typeof BatonLiveAttachInput.Type;

export const BatonLiveAttachResult = Schema.Struct({
  saved: Schema.Boolean,
  path: Schema.NullOr(Schema.String),
  detail: Schema.String,
});
export type BatonLiveAttachResult = typeof BatonLiveAttachResult.Type;

export const BatonLiveAdoptInput = Schema.Struct({ sessionId: TrimmedNonEmptyString });
export type BatonLiveAdoptInput = typeof BatonLiveAdoptInput.Type;

export const BatonLiveAdoptResult = Schema.Struct({
  adopted: Schema.Boolean,
  pane: Schema.NullOr(Schema.String),
  detail: Schema.String,
});
export type BatonLiveAdoptResult = typeof BatonLiveAdoptResult.Type;

/**
 * Which project a live session belongs to, the same on every box (D72): the
 * repository's canonical key from T3's own resolver when the directory is a
 * git checkout with a remote, else `dir:<folder name>`. This is what lets one
 * project be one entry across accounts and machines.
 */
export const BatonProjectRef = Schema.Struct({
  key: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
});
export type BatonProjectRef = typeof BatonProjectRef.Type;

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
  project: Schema.optionalKey(BatonProjectRef),
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
