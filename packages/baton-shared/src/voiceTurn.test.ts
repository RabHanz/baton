import { describe, expect, it } from "vite-plus/test";

import {
  frameLevel,
  IDLE_TURN,
  reduceTurn,
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
    expect(reduceTurn(speaking, { type: "speaking", active: false }).phase).toBe("idle");
  });

  it("shows an error when the window closes on nothing heard", () => {
    expect(play([{ type: "wake", word: null }, { type: "window_closed" }])).toMatchObject({
      phase: "error",
      caption: "Didn't catch that",
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
    expect(play([{ type: "wake", word: null }, { type: "dismissed" }]).phase).toBe("idle");
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
    expect(state.phase).toBe("idle");
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

describe("frameLevel", () => {
  it("is zero for silence and capped for a full frame", () => {
    expect(frameLevel(new Int16Array(160))).toBe(0);
    expect(frameLevel(new Int16Array(160).fill(32767))).toBe(1);
  });
});
