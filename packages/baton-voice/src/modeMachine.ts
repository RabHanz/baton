/* oxlint-disable t3code/no-low-value-comments -- Baton file predating upstream's rule (D82) */
/**
 * §12.3's voice modes as a pure reducer. No audio, no clock, no I/O: every
 * event carries its own time, so the whole thing is replayable in a test.
 *
 *   sleeping ──wake──▶ command_window ──utterance──▶ conversation
 *        ▲                    │ timeout                 │ timeout / "that's all"
 *        └────────────────────┴─────────────────────────┘
 *   (base) direct_session when enabled: plain speech goes to the focused session
 *   dictation: entered by "dictate", left only by "stop dictating"
 *
 * Rules this enforces:
 *   - Without a wake (or an explicit activation) nothing said is acted on,
 *     except in direct-session mode, which the user switched on.
 *   - Follow-ups in conversation inherit the target the last command resolved
 *     to; no repeated wake phrase.
 *   - Dictation is a separate effect kind from commands and session messages,
 *     so dictated words can never be routed to an agent by accident.
 *   - A pending confirmation is answered only by a later, separate utterance
 *     inside the window. The wake word alone is stripped before that check, so
 *     "hey jarvis" can never be the "yes".
 *
 * @module baton-voice/modeMachine
 */
import { classifyDictation } from "@t3tools/baton-shared/dictation";

export type VoiceMode =
  | "sleeping"
  | "command_window"
  | "conversation"
  | "direct_session"
  | "dictation";

export interface PendingConfirmation {
  /** Opaque to the machine; the router knows what it means. */
  readonly token: string;
  readonly prompt: string;
  readonly expiresAt: number;
}

export interface VoiceMachineState {
  readonly mode: VoiceMode;
  /** Direct-session toggle; decides the mode we fall back to. */
  readonly directSession: boolean;
  /** Work session follow-ups inherit (§14 rung 2). */
  readonly conversationTarget: string | null;
  /** When the command window / conversation closes. */
  readonly deadline: number | null;
  readonly pending: PendingConfirmation | null;
}

export interface VoiceTimings {
  /** The wake words in use, stripped from the front of what was heard. */
  readonly wakeWords?: ReadonlyArray<string>;
  readonly commandWindowMs: number;
  readonly conversationMs: number;
  readonly confirmationMs: number;
}

export const DEFAULT_TIMINGS: VoiceTimings = {
  commandWindowMs: 8_000,
  conversationMs: 30_000,
  confirmationMs: 15_000,
};

export type VoiceEvent =
  | { readonly type: "wake"; readonly at: number }
  | { readonly type: "utterance"; readonly text: string; readonly at: number }
  | { readonly type: "tick"; readonly at: number }
  | { readonly type: "set_direct_session"; readonly enabled: boolean; readonly at: number }
  | { readonly type: "set_target"; readonly workSessionId: string | null; readonly at: number }
  | {
      readonly type: "request_confirmation";
      readonly token: string;
      readonly prompt: string;
      readonly at: number;
    };

export type VoiceEffect =
  /** A command for the intent path, with the target a follow-up inherits. */
  | { readonly kind: "command"; readonly text: string; readonly inheritedTarget: string | null }
  /** Direct-session speech: a user message to the focused session. */
  | { readonly kind: "session_message"; readonly text: string }
  /** Text for the focused editable field. Never leaves the client. */
  | { readonly kind: "dictate"; readonly text: string }
  | { readonly kind: "confirmed"; readonly token: string }
  | {
      readonly kind: "cancelled";
      readonly token: string;
      readonly reason: "declined" | "expired" | "superseded";
    }
  | { readonly kind: "speak"; readonly text: string }
  /** Heard but deliberately not acted on — sleeping, or a bare wake word. */
  | { readonly kind: "ignored"; readonly text: string; readonly reason: string };

export interface VoiceStep {
  readonly state: VoiceMachineState;
  readonly effects: ReadonlyArray<VoiceEffect>;
}

export const initialVoiceState = (directSession = false): VoiceMachineState => ({
  mode: directSession ? "direct_session" : "sleeping",
  directSession,
  conversationTarget: null,
  deadline: null,
  pending: null,
});

/** "baton" always works: a button-opened window's transcript may start with it. */
const wakePrefix = (words: ReadonlyArray<string>): RegExp => {
  const names = ["baton", ...words].map((word) => word.replace(/[^\p{L}\p{N} ]/gu, "")).join("|");
  return new RegExp(`^(?:hey |ok |okay )?(?:${names})\\b[\\s,.:!?-]*`, "iu");
};
const AFFIRM =
  /^(?:confirm(?:ed)?|yes(?:,? (?:do it|confirm|go ahead))?|go ahead|do it|approve(?:d)?)[.!]?$/i;
const DECLINE = /^(?:no|cancel|stop|don't|do not|never mind|nevermind|abort)\b/i;
const SLEEP =
  /^(?:that's all|thats all|that is all|go to sleep|stop listening|thanks,? that's it|goodbye)[.!]?$/i;

/** The words with any wake phrase removed. Exported for the router's checks. */
export const stripWake = (text: string, words: ReadonlyArray<string> = ["jarvis"]): string =>
  text.trim().replace(wakePrefix(words), "").trim();

const base = (state: VoiceMachineState): VoiceMachineState => ({
  ...state,
  mode: state.directSession ? "direct_session" : "sleeping",
  deadline: null,
  conversationTarget: null,
  pending: null,
});

const step = (state: VoiceMachineState, effects: ReadonlyArray<VoiceEffect> = []): VoiceStep => ({
  state,
  effects,
});

/** Close a window whose deadline passed, and expire a stale confirmation. */
const expire = (state: VoiceMachineState, at: number): VoiceStep => {
  const effects: VoiceEffect[] = [];
  let next = state;
  if (next.pending !== null && at > next.pending.expiresAt) {
    effects.push({ kind: "cancelled", token: next.pending.token, reason: "expired" });
    next = { ...next, pending: null };
  }
  if (
    (next.mode === "command_window" || next.mode === "conversation") &&
    next.deadline !== null &&
    at > next.deadline
  ) {
    next = base(next);
  }
  return step(next, effects);
};

export const reduceVoice = (
  state: VoiceMachineState,
  event: VoiceEvent,
  timings: VoiceTimings = DEFAULT_TIMINGS,
): VoiceStep => {
  const expired = expire(state, event.at);
  const s = expired.state;
  const carry = expired.effects;

  switch (event.type) {
    case "tick":
      return expired;

    case "set_direct_session": {
      const next = { ...s, directSession: event.enabled };
      // Toggling only moves the resting mode; an open window or dictation stays.
      if (s.mode === "sleeping" || s.mode === "direct_session") {
        return step({ ...next, mode: event.enabled ? "direct_session" : "sleeping" }, carry);
      }
      return step(next, carry);
    }

    case "set_target":
      return step({ ...s, conversationTarget: event.workSessionId }, carry);

    case "request_confirmation": {
      const superseded: VoiceEffect[] =
        s.pending === null
          ? []
          : [{ kind: "cancelled", token: s.pending.token, reason: "superseded" }];
      return step(
        {
          ...s,
          mode: s.mode === "dictation" ? s.mode : "conversation",
          deadline: event.at + Math.max(timings.conversationMs, timings.confirmationMs),
          pending: {
            token: event.token,
            prompt: event.prompt,
            expiresAt: event.at + timings.confirmationMs,
          },
        },
        [...carry, ...superseded, { kind: "speak", text: event.prompt }],
      );
    }

    case "wake": {
      // Dictation is left only by its own stop phrase; a wake mid-dictation
      // just keeps listening so "jarvis, stop dictating" works.
      if (s.mode === "dictation") return step(s, carry);
      return step(
        {
          ...s,
          mode: "command_window",
          deadline: event.at + timings.commandWindowMs,
        },
        carry,
      );
    }

    case "utterance":
      return utterance(s, event.text, event.at, timings, carry);
  }
};

const utterance = (
  s: VoiceMachineState,
  text: string,
  at: number,
  timings: VoiceTimings,
  carry: ReadonlyArray<VoiceEffect>,
): VoiceStep => {
  const raw = text.trim();
  const words = stripWake(raw, timings.wakeWords);

  if (s.mode === "dictation") {
    const d = classifyDictation(raw, { dictating: true });
    if (d.kind === "stop")
      return step(base(s), [...carry, { kind: "speak", text: "Stopped dictating." }]);
    if (d.kind === "text" && words.length > 0)
      return step(s, [...carry, { kind: "dictate", text: raw }]);
    return step(s, carry);
  }

  const awake = s.mode === "command_window" || s.mode === "conversation";
  const startsWithWake = words !== raw;

  // Sleeping hears nothing but the wake detector. An STT transcript that
  // happens to start with "jarvis" (activation by button) is treated as awake.
  if (s.mode === "sleeping" && !startsWithWake) {
    return step(s, [...carry, { kind: "ignored", text: raw, reason: "asleep" }]);
  }
  if (words.length === 0) {
    // A bare wake word opens the window and does nothing else — and, above
    // all, never answers a pending confirmation.
    return step(
      { ...s, mode: awake ? s.mode : "command_window", deadline: at + timings.commandWindowMs },
      [...carry, { kind: "ignored", text: raw, reason: "wake word only" }],
    );
  }

  const d = classifyDictation(words, { dictating: false });
  if (d.kind === "start") {
    const next: VoiceMachineState = { ...s, mode: "dictation", deadline: null, pending: null };
    const cancel: VoiceEffect[] =
      s.pending === null
        ? []
        : [{ kind: "cancelled", token: s.pending.token, reason: "superseded" }];
    return step(next, [
      ...carry,
      ...cancel,
      ...(d.text === null ? [] : [{ kind: "dictate", text: d.text } as const]),
    ]);
  }
  if (d.kind === "stop")
    return step(s, [...carry, { kind: "ignored", text: raw, reason: "not dictating" }]);

  if (SLEEP.test(words) && (awake || startsWithWake)) {
    return step(base(s), [
      ...carry,
      ...(s.pending === null
        ? []
        : [{ kind: "cancelled", token: s.pending.token, reason: "declined" } as const]),
    ]);
  }

  if (s.pending !== null) {
    if (AFFIRM.test(words)) {
      return step(
        { ...s, pending: null, mode: "conversation", deadline: at + timings.conversationMs },
        [...carry, { kind: "confirmed", token: s.pending.token }],
      );
    }
    if (DECLINE.test(words)) {
      return step(
        { ...s, pending: null, mode: "conversation", deadline: at + timings.conversationMs },
        [
          ...carry,
          { kind: "cancelled", token: s.pending.token, reason: "declined" },
          { kind: "speak", text: "Cancelled." },
        ],
      );
    }
    // Anything else is a new instruction; the old question lapses.
    carry = [...carry, { kind: "cancelled", token: s.pending.token, reason: "superseded" }];
    s = { ...s, pending: null };
  }

  if (awake || startsWithWake) {
    return step({ ...s, mode: "conversation", deadline: at + timings.conversationMs }, [
      ...carry,
      { kind: "command", text: words, inheritedTarget: s.conversationTarget },
    ]);
  }

  // direct_session, no window open: plain speech is a message to the session.
  return step(s, [...carry, { kind: "session_message", text: raw }]);
};
