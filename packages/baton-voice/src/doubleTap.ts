/**
 * Double-tap push to talk as a pure reducer over the hold key's down/up edges.
 * Times are caller-supplied milliseconds; events that go back in time or do not
 * fit the current state (a second down, a stray up) are ignored.
 */

export interface PushToTalkKeyEvent {
  readonly type: "down" | "up";
  readonly at: number;
}

export type PushToTalkOutput = "start" | "stop" | "cancel" | "latch" | "unlatch";

export const DOUBLE_TAP_TIMINGS = {
  /** A press shorter than this cancels the dictation it started. */
  shortTapMs: 200,
  /** The first press of a double tap must be shorter than this. */
  firstPressMs: 350,
  /** The second down must land within this long of the first up. */
  gapMs: 350,
  /** A press longer than this is always a normal hold. */
  holdMs: 600,
} as const;

export type PushToTalkState =
  | { readonly phase: "idle"; readonly lastAt: number }
  | { readonly phase: "tapped"; readonly lastAt: number; readonly upAt: number }
  | {
      readonly phase: "holding";
      readonly lastAt: number;
      readonly downAt: number;
      readonly afterTap: boolean;
    }
  | { readonly phase: "latched"; readonly lastAt: number }
  | { readonly phase: "latchedDown"; readonly lastAt: number };

export interface PushToTalkStep {
  readonly state: PushToTalkState;
  readonly outputs: ReadonlyArray<PushToTalkOutput>;
}

export const initialPushToTalkState: PushToTalkState = {
  phase: "idle",
  lastAt: Number.NEGATIVE_INFINITY,
};

const ignore = (state: PushToTalkState): PushToTalkStep => ({ state, outputs: [] });

export const reducePushToTalk = (
  state: PushToTalkState,
  event: PushToTalkKeyEvent,
  settings: { readonly doubleTap: boolean },
): PushToTalkStep => {
  const { at } = event;
  if (!Number.isFinite(at) || at < state.lastAt) return ignore(state);
  const t = DOUBLE_TAP_TIMINGS;

  if (event.type === "down") {
    switch (state.phase) {
      case "idle":
      case "tapped": {
        const afterTap =
          settings.doubleTap && state.phase === "tapped" && at - state.upAt <= t.gapMs;
        return {
          state: { phase: "holding", lastAt: at, downAt: at, afterTap },
          outputs: ["start"],
        };
      }
      case "latched":
        return { state: { phase: "latchedDown", lastAt: at }, outputs: [] };
      default:
        return ignore(state);
    }
  }

  switch (state.phase) {
    case "holding": {
      if (!settings.doubleTap) return { state: { phase: "idle", lastAt: at }, outputs: ["stop"] };
      const held = at - state.downAt;
      if (state.afterTap && held <= t.holdMs) {
        return { state: { phase: "latched", lastAt: at }, outputs: ["latch"] };
      }
      const output: PushToTalkOutput = held < t.shortTapMs ? "cancel" : "stop";
      const next: PushToTalkState =
        !state.afterTap && held < t.firstPressMs
          ? { phase: "tapped", lastAt: at, upAt: at }
          : { phase: "idle", lastAt: at };
      return { state: next, outputs: [output] };
    }
    case "latchedDown":
      return { state: { phase: "idle", lastAt: at }, outputs: ["unlatch", "stop"] };
    default:
      return ignore(state);
  }
};

/** Folds a whole key sequence; convenient for tests and replay. */
export const runPushToTalk = (
  events: ReadonlyArray<PushToTalkKeyEvent>,
  settings: { readonly doubleTap: boolean },
  from: PushToTalkState = initialPushToTalkState,
): PushToTalkStep => {
  let state = from;
  const outputs: Array<PushToTalkOutput> = [];
  for (const event of events) {
    const step = reducePushToTalk(state, event, settings);
    state = step.state;
    outputs.push(...step.outputs);
  }
  return { state, outputs };
};
