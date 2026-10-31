import { describe, expect, it } from "vite-plus/test";

import { frameLevel, IDLE_TURN, reduceTurn, type TurnEvent, type TurnState } from "./voiceTurn.ts";

const play = (events: ReadonlyArray<TurnEvent>, start: TurnState = IDLE_TURN) =>
  events.reduce(reduceTurn, start);

describe("the cue after a wake word", () => {
  it("goes listening, thinking, speaking, then away by itself", () => {
    const afterWake = play([{ type: "wake" }]);
    expect(afterWake.phase).toBe("listening");
    const heard = reduceTurn(afterWake, { type: "heard", text: "what needs me" });
    expect(heard).toMatchObject({ phase: "thinking", caption: "what needs me" });
    const speaking = reduceTurn(heard, { type: "speaking", active: true });
    expect(speaking.phase).toBe("speaking");
    expect(reduceTurn(speaking, { type: "speaking", active: false }).phase).toBe("idle");
  });

  it("shows an error when the window closes on nothing heard", () => {
    expect(play([{ type: "wake" }, { type: "window_closed" }])).toMatchObject({
      phase: "error",
      caption: "Didn't catch that",
    });
  });

  it("does not call a heard turn a failure when its window closes", () => {
    const state = play([
      { type: "wake" },
      { type: "heard", text: "hi" },
      { type: "window_closed" },
    ]);
    expect(state.phase).toBe("thinking");
  });

  it("clears on dismissal from any phase", () => {
    expect(play([{ type: "wake" }, { type: "dismissed" }]).phase).toBe("idle");
  });

  it("shows nothing at rest, whatever arrives", () => {
    expect(play([{ type: "heard", text: "background" }]).phase).toBe("idle");
    expect(play([{ type: "failed", message: "x" }]).phase).toBe("idle");
    expect(play([{ type: "speaking", active: true }]).phase).toBe("idle");
  });

  it("clears a turn that ends with nothing to say", () => {
    const state = play([{ type: "wake" }, { type: "heard", text: "stop" }, { type: "finished" }]);
    expect(state.phase).toBe("idle");
  });

  it("keeps speech on screen until it finishes", () => {
    const state = play([
      { type: "wake" },
      { type: "speaking", active: true },
      { type: "finished" },
    ]);
    expect(state.phase).toBe("speaking");
  });
});

describe("frameLevel", () => {
  it("is zero for silence and capped for a full frame", () => {
    expect(frameLevel(new Int16Array(160))).toBe(0);
    expect(frameLevel(new Int16Array(160).fill(32767))).toBe(1);
  });
});
