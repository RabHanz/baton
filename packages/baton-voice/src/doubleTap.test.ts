import { describe, expect, it } from "vite-plus/test";

import { type PushToTalkKeyEvent, reducePushToTalk, runPushToTalk } from "./doubleTap.ts";

const d = (at: number): PushToTalkKeyEvent => ({ type: "down", at });
const u = (at: number): PushToTalkKeyEvent => ({ type: "up", at });

describe("reducePushToTalk", () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly events: ReadonlyArray<PushToTalkKeyEvent>;
    readonly doubleTap?: boolean;
    readonly outputs: ReadonlyArray<string>;
    readonly phase: string;
  }> = [
    { name: "hold", events: [d(0), u(1000)], outputs: ["start", "stop"], phase: "idle" },
    { name: "medium press", events: [d(0), u(400)], outputs: ["start", "stop"], phase: "idle" },
    { name: "short tap", events: [d(0), u(150)], outputs: ["start", "cancel"], phase: "tapped" },
    {
      name: "tap at the short-tap boundary stops",
      events: [d(0), u(200)],
      outputs: ["start", "stop"],
      phase: "tapped",
    },
    {
      name: "double tap latches",
      events: [d(0), u(100), d(300), u(380)],
      outputs: ["start", "cancel", "start", "latch"],
      phase: "latched",
    },
    {
      name: "double tap with a 300 ms first press",
      events: [d(0), u(300), d(600), u(700)],
      outputs: ["start", "stop", "start", "latch"],
      phase: "latched",
    },
    {
      name: "gap too long is two taps",
      events: [d(0), u(100), d(451), u(500)],
      outputs: ["start", "cancel", "start", "cancel"],
      phase: "tapped",
    },
    {
      name: "first press too long is no double tap",
      events: [d(0), u(350), d(400), u(450)],
      outputs: ["start", "stop", "start", "cancel"],
      phase: "tapped",
    },
    {
      name: "triple tap latches then ends",
      events: [d(0), u(100), d(200), u(300), d(400), u(500)],
      outputs: ["start", "cancel", "start", "latch", "unlatch", "stop"],
      phase: "idle",
    },
    {
      name: "latch then a long press ends it",
      events: [d(0), u(100), d(200), u(300), d(5000), u(7000)],
      outputs: ["start", "cancel", "start", "latch", "unlatch", "stop"],
      phase: "idle",
    },
    {
      name: "after ending a latch, a tap is a fresh tap",
      events: [d(0), u(100), d(200), u(300), d(400), u(500), d(600), u(650)],
      outputs: ["start", "cancel", "start", "latch", "unlatch", "stop", "start", "cancel"],
      phase: "tapped",
    },
    {
      name: "long hold after a tap is a normal hold",
      events: [d(0), u(100), d(200), u(801)],
      outputs: ["start", "cancel", "start", "stop"],
      phase: "idle",
    },
    {
      name: "setting off: short tap stops",
      doubleTap: false,
      events: [d(0), u(100)],
      outputs: ["start", "stop"],
      phase: "idle",
    },
    {
      name: "setting off: double tap is two holds",
      doubleTap: false,
      events: [d(0), u(100), d(200), u(300)],
      outputs: ["start", "stop", "start", "stop"],
      phase: "idle",
    },
    {
      name: "duplicate down and stray up are ignored",
      events: [u(0), d(10), d(20), u(1000), u(1100)],
      outputs: ["start", "stop"],
      phase: "idle",
    },
    {
      name: "stray up while latched is ignored",
      events: [d(0), u(100), d(200), u(300), u(350), d(400), d(410), u(500)],
      outputs: ["start", "cancel", "start", "latch", "unlatch", "stop"],
      phase: "idle",
    },
    {
      name: "time going backwards is ignored",
      events: [d(1000), u(900), u(1050), d(500), d(1200), u(1260)],
      outputs: ["start", "cancel", "start", "latch"],
      phase: "latched",
    },
    {
      name: "non-finite times are ignored",
      events: [d(Number.NaN), d(0), u(Number.POSITIVE_INFINITY), u(1000)],
      outputs: ["start", "stop"],
      phase: "idle",
    },
  ];

  it.each(cases)("$name", ({ events, doubleTap = true, outputs, phase }) => {
    const result = runPushToTalk(events, { doubleTap });
    expect(result.outputs).toEqual(outputs);
    expect(result.state.phase).toBe(phase);
  });

  it("matches today's hold-to-talk exactly when the setting is off", () => {
    const events = [d(0), u(50), d(60), u(120), d(130), d(140), u(900), u(950), d(960), u(970)];
    expect(runPushToTalk(events, { doubleTap: false }).outputs).toEqual([
      "start",
      "stop",
      "start",
      "stop",
      "start",
      "stop",
      "start",
      "stop",
    ]);
  });

  it("returns the same state object for ignored events", () => {
    const { state } = runPushToTalk([d(0)], { doubleTap: true });
    expect(reducePushToTalk(state, d(10), { doubleTap: true }).state).toBe(state);
  });
});
