// @effect-diagnostics globalDate:off
/**
 * Home's history (D140), read from `voice-turns.ndjson` (D120). Dictated words are never in that
 * file, only a length, so the history says "Dictated" and how much, never what.
 */
import { OVER_HER_VOICE } from "@t3tools/baton-voice";

import type { HomeActivity } from "./batonHome.ts";

interface Line {
  readonly at?: unknown;
  readonly kind?: unknown;
  readonly transcript?: unknown;
  readonly chars?: unknown;
  readonly text?: unknown;
  readonly reason?: unknown;
  readonly action?: unknown;
  readonly outcome?: unknown;
  readonly message?: unknown;
}

const line = (raw: string): Line | null => {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Line) : null;
  } catch {
    return null;
  }
};

const clip = (text: string, max = 140): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

const toItem = (l: Line): HomeActivity | null => {
  if (typeof l.at !== "string") return null;
  const at = l.at;
  switch (l.kind) {
    case "turn":
      return typeof l.transcript === "string" && l.transcript.trim().length > 0
        ? { at, kind: "heard", text: clip(l.transcript.trim()) }
        : null;
    case "dictated":
      return typeof l.chars === "number"
        ? { at, kind: "dictated", text: `Dictated ${l.chars} characters` }
        : null;
    case "stop":
      return { at, kind: "stopped", text: "You said stop." };
    case "action":
      return typeof l.action === "string" ? { at, kind: "action", text: clip(l.action) } : null;
    case "wake_only":
    case "nothing_heard":
      return { at, kind: "quiet", text: "Heard the wake word, then nothing.", dim: true };
    case "dropped":
      // Her own voice and what was heard over it are not his: Home would fill with them.
      if (typeof l.reason === "string" && OVER_HER_VOICE.has(l.reason)) return null;
      return { at, kind: "ignored", text: "Ignored something it was not sure of.", dim: true };
    case "error":
      return {
        at,
        kind: "problem",
        text: typeof l.message === "string" ? clip(l.message) : "Something went wrong.",
        dim: true,
      };
    default:
      return null;
  }
};

/** Newest first, at most `limit`. A line that does not parse is skipped. */
export const parseActivity = (raw: string, limit = 60): ReadonlyArray<HomeActivity> =>
  raw
    .split("\n")
    .flatMap((text) => {
      const parsed = text.trim().length === 0 ? null : line(text);
      const item = parsed === null ? null : toItem(parsed);
      return item === null ? [] : [item];
    })
    .toReversed()
    .slice(0, limit);

/** Turns and dictations since local midnight of `now`. */
export const todayStats = (
  items: ReadonlyArray<HomeActivity>,
  now: Date,
): { readonly turns: number; readonly dictations: number } => {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const today = items.filter((i) => Date.parse(i.at) >= start.getTime());
  return {
    turns: today.filter((i) => i.kind === "heard").length,
    dictations: today.filter((i) => i.kind === "dictated").length,
  };
};
