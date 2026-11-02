// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { DOUBLE_TAP_TIMINGS, type PushToTalkKeyEvent, reducePushToTalk, runPushToTalk } from "./doubleTap.ts";

const d = (at: number): PushToTalkKeyEvent => ({ type: "down", at });
const u = (at: number): PushToTalkKeyEvent => ({ type: "up", at });

// The table the Rust sidecar replays too (native/baton-dictation, DoubleTap): one set of timings, two implementations.
const fixture = JSON.parse(
  NodeFS.readFileSync(NodePath.join(import.meta.dirname, "../../../docs/baton/fixtures/double-tap.json"), "utf8"),
) as {
  readonly timings: typeof DOUBLE_TAP_TIMINGS;
  readonly cases: ReadonlyArray<{
    readonly name: string;
    readonly doubleTap: boolean;
    readonly events: ReadonlyArray<PushToTalkKeyEvent>;
    readonly outputs: ReadonlyArray<string>;
    readonly phase: string;
  }>;
};

describe("reducePushToTalk", () => {
  it("uses the timings the fixture states", () => {
    expect(fixture.timings).toEqual(DOUBLE_TAP_TIMINGS);
  });

  it.each(fixture.cases)("$name", ({ events, doubleTap, outputs, phase }) => {
    const result = runPushToTalk(events, { doubleTap });
    expect(result.outputs).toEqual(outputs);
    expect(result.state.phase).toBe(phase);
  });

  it("ignores non-finite times", () => {
    const result = runPushToTalk([d(Number.NaN), d(0), u(Number.POSITIVE_INFINITY), u(1000)], { doubleTap: true });
    expect(result.outputs).toEqual(["start", "stop"]);
    expect(result.state.phase).toBe("idle");
  });

  it("returns the same state object for ignored events", () => {
    const { state } = runPushToTalk([d(0)], { doubleTap: true });
    expect(reducePushToTalk(state, d(10), { doubleTap: true }).state).toBe(state);
  });
});
