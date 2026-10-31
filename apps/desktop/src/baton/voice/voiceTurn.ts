/**
 * The cue after a wake word, as a pure reducer. It exists only during a turn: at rest there is
 * nothing on screen, whatever the background wake listening is doing.
 */
export type TurnPhase = "idle" | "listening" | "thinking" | "speaking" | "error";

export interface TurnState {
  readonly phase: TurnPhase;
  /** What was heard, or what went wrong. */
  readonly caption: string | null;
  /** Something was transcribed since the wake, so a closing window is not "heard nothing". */
  readonly heard: boolean;
}

export type TurnEvent =
  | { readonly type: "wake" }
  | { readonly type: "heard"; readonly text: string }
  | { readonly type: "thinking" }
  | { readonly type: "speaking"; readonly active: boolean }
  /** The wake or conversation window closed. */
  | { readonly type: "window_closed" }
  /** The turn's words have been dealt with and nothing more is coming. */
  | { readonly type: "finished" }
  | { readonly type: "dismissed" }
  | { readonly type: "failed"; readonly message: string };

export const IDLE_TURN: TurnState = { phase: "idle", caption: null, heard: false };
/** Long enough to read, short enough not to linger. */
export const TURN_ERROR_MS = 3_500;
/** A turn that never reports an end still leaves the screen. */
export const TURN_LIMIT_MS = 90_000;

const NOTHING_HEARD = "Didn't catch that";
const CAPTION_CHARS = 90;

const short = (text: string): string =>
  text.length > CAPTION_CHARS ? `${text.slice(0, CAPTION_CHARS)}…` : text;

export const reduceTurn = (state: TurnState, event: TurnEvent): TurnState => {
  switch (event.type) {
    case "wake":
      return { phase: "listening", caption: null, heard: false };
    case "heard":
      return state.phase === "idle"
        ? state
        : { phase: "thinking", caption: short(event.text), heard: true };
    case "thinking":
      return state.phase === "listening" ? { ...state, phase: "thinking" } : state;
    case "speaking":
      if (state.phase === "idle") return state;
      return event.active
        ? { ...state, phase: "speaking" }
        : state.phase === "speaking"
          ? IDLE_TURN
          : state;
    case "window_closed":
      if (state.phase === "listening" && !state.heard) {
        return { phase: "error", caption: NOTHING_HEARD, heard: false };
      }
      return state.phase === "listening" ? IDLE_TURN : state;
    case "finished":
      return state.phase === "speaking" || state.phase === "error" ? state : IDLE_TURN;
    case "dismissed":
      return IDLE_TURN;
    case "failed":
      return state.phase === "idle"
        ? state
        : { phase: "error", caption: short(event.message), heard: state.heard };
  }
};

export interface TurnView {
  readonly label: string;
  readonly color: string;
}

export const turnView = (phase: Exclude<TurnPhase, "idle">): TurnView =>
  ({
    listening: { label: "Listening", color: "#22c55e" },
    thinking: { label: "Thinking", color: "#a78bfa" },
    speaking: { label: "Speaking", color: "#3b82f6" },
    error: { label: "Didn't work", color: "#f59e0b" },
  })[phase];

/** Peak of a frame on a rough 0..1 scale for the level bar. */
export const frameLevel = (frame: Int16Array): number => {
  let peak = 0;
  for (let i = 0; i < frame.length; i += 8) peak = Math.max(peak, Math.abs(frame[i]!));
  return Math.min(1, Math.sqrt(peak / 32768) * 1.4);
};
