import { describe, expect, it } from "vite-plus/test";

import {
  frameLevel,
  IDLE_TURN,
  reduceTurn,
  turnHoldsEscape,
  turnLimitMs,
  turnView,
  type TurnEvent,
  type TurnState,
} from "./voiceTurn.ts";

const play = (events: ReadonlyArray<TurnEvent>, start: TurnState = IDLE_TURN) =>
  events.reduce(reduceTurn, start);

describe("the cue after a wake word", () => {
  it("goes listening, thinking, speaking, then away by itself", () => {
    const afterWake = play([{ type: "wake", word: "Alfred" }]);
    expect(afterWake.phase).toBe("listening");
    const heard = reduceTurn(afterWake, { type: "heard", text: "what needs me" });
    expect(heard).toMatchObject({ phase: "thinking", caption: "what needs me" });
    const speaking = reduceTurn(heard, { type: "speaking", active: true });
    expect(speaking.phase).toBe("speaking");
    const after = reduceTurn(speaking, { type: "speaking", active: false });
    expect(after.phase).toBe("listening");
    expect(play([{ type: "window_closed" }, { type: "dismissed" }], after).phase).toBe("idle");
  });

  it("says plainly that the wake word is needed when nothing was heard", () => {
    const state = play([{ type: "wake", word: null }, { type: "window_closed" }]);
    expect(turnView(state)).toMatchObject({
      label: "Didn't catch that",
      caption: "Say the wake word",
    });
  });

  it("does not call a heard turn a failure when its window closes", () => {
    const state = play([
      { type: "wake", word: null },
      { type: "heard", text: "hi" },
      { type: "window_closed" },
    ]);
    expect(state.phase).toBe("thinking");
  });

  it("clears on dismissal from any phase", () => {
    const closed: ReadonlyArray<TurnEvent> = [
      { type: "wake", word: null },
      { type: "dismissed" },
      { type: "window_closed" },
      { type: "dismissed" },
    ];
    expect(play(closed).phase).toBe("idle");
  });

  it("shows nothing at rest, whatever arrives", () => {
    expect(play([{ type: "heard", text: "background" }]).phase).toBe("idle");
    expect(play([{ type: "failed", message: "x" }]).phase).toBe("idle");
  });

  it("clears a turn that ends with nothing to say", () => {
    const state = play([
      { type: "wake", word: null },
      { type: "heard", text: "stop" },
      { type: "finished" },
    ]);
    expect(state.phase).toBe("listening");
  });

  it("keeps speech on screen until it finishes", () => {
    const state = play([
      { type: "wake", word: null },
      { type: "speaking", active: true },
      { type: "finished" },
    ]);
    expect(state.phase).toBe("speaking");
  });
});

describe("the pill while a window is open", () => {
  const open: ReadonlyArray<TurnEvent> = [
    { type: "wake", word: "Alfred" },
    { type: "heard", text: "what's this" },
  ];

  it("goes back to Listening after each thing, and only then to the end", () => {
    let state = play([...open, { type: "speaking", active: true }]);
    expect(turnView(state)?.label).toBe("Speaking");
    state = reduceTurn(state, { type: "speaking", active: false });
    expect(turnView(state)?.label).toBe("Listening");
    state = play([{ type: "activity", label: "Looking" }], state);
    expect(turnView(state)?.label).toBe("Looking");
    state = reduceTurn(state, { type: "activity", label: null });
    expect(turnView(state)?.label).toBe("Listening");
    state = reduceTurn(state, { type: "window_closed" });
    expect(turnView(state)).toMatchObject({ label: "Not listening", caption: "Say the wake word" });
    expect(turnLimitMs(state.phase)).toBeLessThan(turnLimitMs("listening"));
    expect(reduceTurn(state, { type: "dismissed" }).phase).toBe("idle");
  });

  it("shows the end after speech when the window closed under it", () => {
    const state = play([
      ...open,
      { type: "speaking", active: true },
      { type: "window_closed" },
      { type: "speaking", active: false },
    ]);
    expect(state.phase).toBe("ended");
  });

  it("returns to Listening when words were set aside", () => {
    expect(play([...open, { type: "resume" }]).phase).toBe("listening");
  });

  it("holds Dictating through each chunk, and returns to Listening after", () => {
    let state = play([...open, { type: "dictating", caption: "Say stop dictating" }]);
    state = play(
      [
        { type: "heard", text: "Dear Sam" },
        { type: "thinking" },
        { type: "done", label: "typed" },
        { type: "finished" },
      ],
      state,
    );
    expect(turnView(state)).toMatchObject({ label: "Dictating", caption: "typed" });
    expect(reduceTurn(state, { type: "wake", word: "Alfred" }).phase).toBe("dictating");
    state = reduceTurn(state, { type: "dictating", caption: null });
    expect(state.phase).toBe("listening");
  });

  it("reads Listening again when a stop leaves the window open", () => {
    const state = play([...open, { type: "speaking", active: true }, { type: "dismissed" }]);
    expect(state.phase).toBe("listening");
  });
});

describe("the pill's other states", () => {
  it("names the word that woke it, then what it heard", () => {
    const woken = play([{ type: "wake", word: "Freya" }]);
    expect(turnView(woken)).toMatchObject({ label: "Listening", caption: "Freya" });
    expect(turnView(reduceTurn(woken, { type: "heard", text: "what's this" }))).toMatchObject({
      label: "Thinking",
      caption: "what's this",
    });
  });

  it("says so when the microphone is dead, without ending the turn", () => {
    const state = play([{ type: "wake", word: null }, { type: "silent" }]);
    expect(state.phase).toBe("listening");
    expect(state.caption).toContain("Not hearing");
  });

  it("shows a typed answer's speech and work with no wake word", () => {
    expect(play([{ type: "speaking", active: true }]).phase).toBe("speaking");
    const driving = play([{ type: "activity", label: "Driving", caption: "Step 1 of 3" }]);
    expect(turnView(driving)).toMatchObject({ label: "Driving", caption: "Step 1 of 3" });
    expect(reduceTurn(driving, { type: "activity", label: null }).phase).toBe("idle");
  });

  it("raises trouble with no turn running, briefly confirms, and goes", () => {
    const trouble = play([{ type: "trouble", message: "Mic reconnecting" }]);
    expect(turnView(trouble)?.label).toBe("Mic reconnecting");
    expect(turnLimitMs("error")).toBeLessThan(turnLimitMs("listening"));
    expect(play([{ type: "done", label: "Pasted" }]).label).toBe("Pasted");
  });

  it("does not let a voice turn end dictation or a mute", () => {
    expect(play([{ type: "dictating", caption: "Esc cancels" }, { type: "finished" }]).phase).toBe(
      "dictating",
    );
  });
});

describe("who gets Esc", () => {
  it("is his apps' unless the microphone is live", () => {
    expect(turnHoldsEscape({ ...IDLE_TURN, phase: "listening" })).toBe(true);
    for (const phase of ["idle", "thinking", "speaking", "working", "done", "error"] as const) {
      expect(turnHoldsEscape({ ...IDLE_TURN, phase })).toBe(false);
    }
  });

  it("goes back to his apps once a window has heard him", () => {
    expect(turnHoldsEscape({ ...IDLE_TURN, phase: "listening", heard: true })).toBe(false);
  });
});

describe("frameLevel", () => {
  it("is zero for silence and capped for a full frame", () => {
    expect(frameLevel(new Int16Array(160))).toBe(0);
    expect(frameLevel(new Int16Array(160).fill(32767))).toBe(1);
  });
});
