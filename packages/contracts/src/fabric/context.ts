/**
 * Where the user is, and what can be typed into.
 *
 * §15's desktop context bus, §16's VS Code report, §17's browser report and
 * §18's injection abstraction share one shape, because they answer one
 * question: **which target does this sentence belong to?** §14's ladder is only
 * as good as the facts under it, and every rung above "the user said so" is a
 * fact some producer has to report.
 *
 * Two rules constrain this contract, and both are privacy rules rather than
 * engineering ones:
 *
 *   1. **This is client-local.** §15 says a local authenticated IPC interface,
 *      not a public network API, and nothing here crosses the environment
 *      boundary. The environment learns the *resolved target* — a work session
 *      id — and never the window titles, page origins or field contents that
 *      produced it.
 *   2. **No page content.** §17 is explicit: the browser reports whether the
 *      focused element is editable, what kind of field it is, and where the tab
 *      is — never the text around it. A field label is optional and exists for
 *      the read-back ("insert into Gmail's compose box"), not for context.
 *
 * @module fabric/context
 */
import * as Schema from "effect/Schema";

import { IsoDateTime, ThreadId, TrimmedNonEmptyString, TrimmedString } from "../baseSchemas.ts";
import { WorkSessionId } from "./workSession.ts";

/**
 * Who reported a snapshot. §15's producer list, and the reason the bus keeps
 * one slot per producer rather than one global snapshot: VS Code going quiet
 * must not erase what the browser just said.
 */
export const FabricContextProducer = Schema.Literals([
  /** The Fabric client itself: which work session the user is looking at. */
  "fabric",
  /** The desktop shell: foreground application and window title, where the OS allows. */
  "desktop",
  "vscode",
  "browser",
  /** The voice conversation manager: the target inherited between utterances. */
  "voice",
]);
export type FabricContextProducer = typeof FabricContextProducer.Type;

export const FabricFocusTargetKind = Schema.Literals(["editable", "editor", "terminal", "unknown"]);
export type FabricFocusTargetKind = typeof FabricFocusTargetKind.Type;

/**
 * Somewhere text could go. Deliberately thin: what it is, who owns it, whether
 * it will accept text right now, and enough to name it out loud.
 */
export const FabricFocusTarget = Schema.Struct({
  producer: FabricContextProducer,
  kind: FabricFocusTargetKind,
  /** "Gmail compose", "the editor", "the terminal" — for the read-back. */
  label: TrimmedNonEmptyString,
  /** The producer's own answer to "can I insert here, now?". */
  injectable: Schema.Boolean,
  /**
   * Origin for a browser target, so a dictation refusal can name the site.
   * Never a URL with a path, and never page content.
   */
  origin: Schema.NullOr(TrimmedNonEmptyString),
});
export type FabricFocusTarget = typeof FabricFocusTarget.Type;

/** §16: what the extension observes. Nothing here is a provider bypass. */
export const FabricVsCodeContext = Schema.Struct({
  workspaceFolder: Schema.NullOr(TrimmedNonEmptyString),
  /** `ssh-remote`, `wsl`, `dev-container`; null when the window is local. */
  remoteAuthority: Schema.NullOr(TrimmedNonEmptyString),
  repositoryRoot: Schema.NullOr(TrimmedNonEmptyString),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  /** The file on screen. A path, never its contents. */
  visibleFile: Schema.NullOr(TrimmedNonEmptyString),
  hasSelection: Schema.Boolean,
  activeTerminalName: Schema.NullOr(TrimmedNonEmptyString),
  /** The work session this window is already linked to, when it is. */
  workSessionId: Schema.NullOr(WorkSessionId),
});
export type FabricVsCodeContext = typeof FabricVsCodeContext.Type;

/** §17: focus and editability, and nothing that would be surveillance. */
export const FabricBrowserContext = Schema.Struct({
  /** Which browser profile, so two accounts are distinguishable. */
  profile: Schema.NullOr(TrimmedNonEmptyString),
  /** Origin only: `https://mail.google.com`, never the path or the query. */
  origin: Schema.NullOr(TrimmedNonEmptyString),
  pageTitle: Schema.NullOr(TrimmedNonEmptyString),
  activeElementEditable: Schema.Boolean,
  /** `textarea`, `contenteditable`, `input:text`; null when nothing is focused. */
  fieldType: Schema.NullOr(TrimmedNonEmptyString),
  hasSelection: Schema.Boolean,
  /**
   * The field's own label, when the extension has been given permission to
   * read it. Optional by design — §17 requires explicit capability before any
   * surrounding text is exposed, and this is the smallest useful case.
   */
  fieldLabel: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
});
export type FabricBrowserContext = typeof FabricBrowserContext.Type;

/** §15's snapshot, from one producer, at one instant. */
export const FabricContextSnapshot = Schema.Struct({
  producer: FabricContextProducer,
  observedAt: IsoDateTime,
  foregroundApplication: Schema.NullOr(TrimmedNonEmptyString),
  activeWindowTitle: Schema.NullOr(TrimmedNonEmptyString),
  activeWorkSessionId: Schema.NullOr(WorkSessionId),
  activeThreadId: Schema.NullOr(ThreadId),
  vscode: Schema.NullOr(FabricVsCodeContext),
  browser: Schema.NullOr(FabricBrowserContext),
  editableTarget: Schema.NullOr(FabricFocusTarget),
  recentVoiceTarget: Schema.NullOr(WorkSessionId),
});
export type FabricContextSnapshot = typeof FabricContextSnapshot.Type;

/**
 * How long a producer's snapshot stays authoritative.
 *
 * A context bus whose facts never expire is worse than none: VS Code closed
 * ten minutes ago is not where the user is now, and routing a message there
 * because nothing newer arrived is the failure §14 exists to prevent. Thirty
 * seconds is long enough for a producer that only reports on change and short
 * enough that a dead producer stops voting.
 */
export const CONTEXT_SNAPSHOT_TTL_MS = 30_000;

// ---------------------------------------------------------------------------
// §18 — text injection, reported honestly
// ---------------------------------------------------------------------------

/**
 * §18's preference order, most preferred first. The order is the contract:
 * an application that knows how to insert text does it properly, and simulated
 * keystrokes are what you reach for when everything else has failed.
 */
export const FabricInjectionMethod = Schema.Literals([
  "application",
  "accessibility",
  "clipboard",
  "keystrokes",
]);
export type FabricInjectionMethod = typeof FabricInjectionMethod.Type;

export const FABRIC_INJECTION_PREFERENCE: ReadonlyArray<FabricInjectionMethod> = [
  "application",
  "accessibility",
  "clipboard",
  "keystrokes",
];

export const FabricInjectionCapability = Schema.Struct({
  method: FabricInjectionMethod,
  available: Schema.Boolean,
  /**
   * Why not, in words the user can act on: a permission to grant, a display
   * server that forbids it, a host that is not connected. Never empty when
   * `available` is false — §18's "surface capability must be reported
   * honestly" is only met if the refusal says something.
   */
  reason: TrimmedString,
});
export type FabricInjectionCapability = typeof FabricInjectionCapability.Type;

export const FabricDisplayServer = Schema.Literals(["wayland", "x11", "unknown"]);
export type FabricDisplayServer = typeof FabricDisplayServer.Type;

export const FabricPlatform = Schema.Literals(["darwin", "win32", "linux", "unknown"]);
export type FabricPlatform = typeof FabricPlatform.Type;

export const FabricInjectionReport = Schema.Struct({
  platform: FabricPlatform,
  /** Linux only. Wayland restricts global injection; X11 does not. */
  displayServer: Schema.NullOr(FabricDisplayServer),
  capabilities: Schema.Array(FabricInjectionCapability),
});
export type FabricInjectionReport = typeof FabricInjectionReport.Type;

/** True when at least one method can actually put text somewhere. */
export const canInjectAnywhere = (report: FabricInjectionReport): boolean =>
  report.capabilities.some((capability) => capability.available);

/**
 * The one-line answer to "can you type for me?", written to be spoken.
 *
 * Never "no": always which method is missing and why, because a user told only
 * "no" will try again, and a user told "Wayland does not allow it" will stop.
 */
export const describeInjection = (report: FabricInjectionReport): string => {
  const available = report.capabilities.filter((capability) => capability.available);
  if (available.length > 0) {
    return `I can type into the focused field here (${available[0]?.method}).`;
  }
  const first = report.capabilities.find((capability) => capability.reason.length > 0);
  return first === undefined
    ? "I cannot type into anything from here."
    : `I cannot type into anything from here: ${first.reason}`;
};
