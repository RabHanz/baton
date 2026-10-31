/**
 * What the pill says, as a pure reducer. It exists only while something is happening: at rest
 * there is nothing on screen, whatever the background wake listening is doing (D112).
 */
export type TurnPhase =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "working"
  | "dictating"
  | "muted"
  | "done"
  | "error";

export interface TurnState {
  readonly phase: TurnPhase;
  /** What was heard, what is running, or what went wrong. */
  readonly caption: string | null;
  /** Something was transcribed since the wake, so a closing window is not "heard nothing". */
  readonly heard: boolean;
  /** The label while `working` or `done`: "Looking", "Driving". */
  readonly label: string | null;
  /** The wake word that fired, or where the words are going. */
  readonly detail: string | null;
}

export type TurnEvent =
  | { readonly type: "wake"; readonly word: string | null }
  | { readonly type: "heard"; readonly text: string }
  | { readonly type: "thinking" }
  | { readonly type: "speaking"; readonly active: boolean }
  /** Where his words are going, once the router has a target. */
  | { readonly type: "target"; readonly name: string | null }
  /** The assistant is looking, driving or teaching; null when it stops. */
  | { readonly type: "activity"; readonly label: string | null; readonly caption?: string }
  | { readonly type: "dictating"; readonly caption: string | null }
  | { readonly type: "muted"; readonly on: boolean }
  /** A brief confirmation: "Pasted", "Sent". */
  | { readonly type: "done"; readonly label: string }
  /** Four seconds of a dead level while listening. */
  | { readonly type: "silent" }
  /** The wake or conversation window closed. */
  | { readonly type: "window_closed" }
  /** The turn's words have been dealt with and nothing more is coming. */
  | { readonly type: "finished" }
  | { readonly type: "dismissed" }
  | { readonly type: "failed"; readonly message: string }
  /** Trouble worth raising even with no turn running: the microphone dropped. */
  | { readonly type: "trouble"; readonly message: string };

export const IDLE_TURN: TurnState = {
  phase: "idle",
  caption: null,
  heard: false,
  label: null,
  detail: null,
};
/** Long enough to read, short enough not to linger. */
export const TURN_ERROR_MS = 3_500;
export const TURN_BRIEF_MS = 1_600;
/** A turn that never reports an end still leaves the screen. */
export const TURN_LIMIT_MS = 90_000;
export const SILENT_AFTER_MS = 4_000;

const NOTHING_HEARD = "Didn't catch that";
const NOT_HEARING = "Not hearing your mic";
const CAPTION_CHARS = 90;

const short = (text: string): string =>
  text.length > CAPTION_CHARS ? `${text.slice(0, CAPTION_CHARS)}…` : text;

export const reduceTurn = (state: TurnState, event: TurnEvent): TurnState => {
  switch (event.type) {
    case "wake":
      return { ...IDLE_TURN, phase: "listening", detail: event.word };
    case "heard":
      return state.phase === "idle" || state.phase === "dictating"
        ? state
        : { ...state, phase: "thinking", caption: short(event.text), heard: true };
    case "thinking":
      return state.phase === "listening" ? { ...state, phase: "thinking" } : state;
    case "speaking":
      if (event.active) return { ...state, phase: "speaking", label: null };
      return state.phase === "speaking" ? IDLE_TURN : state;
    case "target":
      return state.phase === "idle" ? state : { ...state, detail: event.name };
    case "activity":
      if (event.label === null) return state.phase === "working" ? IDLE_TURN : state;
      return {
        ...state,
        phase: state.phase === "speaking" ? "speaking" : "working",
        label: event.label,
        caption: event.caption ?? null,
      };
    case "dictating":
      if (event.caption === null) return state.phase === "dictating" ? IDLE_TURN : state;
      return { ...IDLE_TURN, phase: "dictating", caption: event.caption };
    case "muted":
      if (event.on) return { ...IDLE_TURN, phase: "muted" };
      return state.phase === "muted" ? IDLE_TURN : state;
    case "done":
      return state.phase === "idle" || state.phase === "dictating"
        ? { ...IDLE_TURN, phase: "done", label: event.label }
        : state;
    case "silent":
      return state.phase === "listening" && !state.heard
        ? { ...state, caption: NOT_HEARING }
        : state;
    case "window_closed":
      if (state.phase === "listening" && !state.heard) {
        return { ...IDLE_TURN, phase: "error", caption: NOTHING_HEARD };
      }
      return state.phase === "listening" ? IDLE_TURN : state;
    case "finished":
      return state.phase === "speaking" ||
        state.phase === "error" ||
        state.phase === "dictating" ||
        state.phase === "muted"
        ? state
        : IDLE_TURN;
    case "dismissed":
      return IDLE_TURN;
    case "failed":
      return state.phase === "idle"
        ? state
        : { ...IDLE_TURN, phase: "error", caption: short(event.message), heard: state.heard };
    case "trouble":
      return { ...IDLE_TURN, phase: "error", caption: short(event.message) };
  }
};

export type WaveMode = "live" | "sweep" | "flat";

export interface TurnView {
  readonly label: string;
  /** A second, quieter word: the wake word, the target, what was heard. */
  readonly caption: string | null;
  readonly tone: "plain" | "voice" | "write" | "warn" | "off" | "good";
  readonly wave: WaveMode;
}

const views: Record<Exclude<TurnPhase, "idle">, Omit<TurnView, "caption">> = {
  listening: { label: "Listening", tone: "plain", wave: "live" },
  thinking: { label: "Thinking", tone: "plain", wave: "sweep" },
  speaking: { label: "Speaking", tone: "voice", wave: "live" },
  working: { label: "Working", tone: "voice", wave: "sweep" },
  dictating: { label: "Dictating", tone: "write", wave: "live" },
  muted: { label: "Muted", tone: "off", wave: "flat" },
  done: { label: "Done", tone: "good", wave: "flat" },
  error: { label: "Didn't work", tone: "warn", wave: "flat" },
};

export const turnView = (state: TurnState): TurnView | null => {
  if (state.phase === "idle") return null;
  const view = views[state.phase];
  // An error's words are the headline; there is nothing to add beside them.
  if (state.phase === "error") {
    return { ...view, label: state.caption ?? view.label, caption: null };
  }
  const parts = [state.caption, state.detail].filter((part) => part !== null);
  return {
    ...view,
    label: state.label ?? view.label,
    caption: parts.length > 0 ? parts[0]! : null,
  };
};

/** How long a phase may stay up with nothing further happening. */
export const turnLimitMs = (phase: TurnPhase): number =>
  phase === "error"
    ? TURN_ERROR_MS
    : phase === "done" || phase === "muted"
      ? TURN_BRIEF_MS
      : TURN_LIMIT_MS;

/**
 * Esc belongs to his apps unless the microphone is live. Dictation holds it itself, a drive as its
 * safety stop, and the ask box and prompts hear it through their own focus.
 */
export const turnHoldsEscape = (phase: TurnPhase): boolean => phase === "listening";

/** Peak of a frame on a rough 0..1 scale for the waveform. */
export const frameLevel = (frame: Int16Array): number => {
  let peak = 0;
  for (let i = 0; i < frame.length; i += 8) peak = Math.max(peak, Math.abs(frame[i]!));
  return Math.min(1, Math.sqrt(peak / 32768) * 1.4);
};
