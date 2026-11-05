// @effect-diagnostics globalDate:off
import { describe, expect, it } from "vite-plus/test";

import { makeVoiceTurnLog } from "./voiceTurnLog.ts";

const rig = () => {
  const lines: Array<Record<string, unknown>> = [];
  const log = makeVoiceTurnLog(
    (line) => lines.push(JSON.parse(line)),
    () => new Date("2026-11-01T00:00:00.000Z"),
  );
  return { lines, log };
};
const timings = {
  route: "answer",
  source: "model",
  decideMs: 900,
  firstSentenceMs: 2100,
  totalMs: 6000,
};

describe("the voice log", () => {
  it("writes one line for a turn: wake, words, route and times", () => {
    const { lines, log } = rig();
    log.event({ type: "wake", word: "Alfred", score: 0.97, at: 1, lateMs: 900, checkMs: 700 });
    log.event({ type: "transcript", text: "what time is it", at: 2 });
    log.timings(timings);
    expect(lines).toEqual([
      {
        at: "2026-11-01T00:00:00.000Z",
        kind: "turn",
        wake: { word: "Alfred", score: 0.97, lateMs: 900, checkMs: 700 },
        transcript: "what time is it",
        ...timings,
      },
    ]);
  });

  it("records noise it dropped, a spoken stop, and a wake with nothing after it", () => {
    const { lines, log } = rig();
    log.event({ type: "wake", word: "Freya", score: 0.96, at: 1 });
    log.event({ type: "dropped", text: "Yeah.", reason: "filler" });
    log.event({ type: "stop_heard", text: "stop", at: 2 });
    log.event({ type: "state", state: "sleeping", target: null });
    expect(lines.map((line) => line["kind"])).toEqual(["dropped", "stop", "wake_only"]);
    expect(lines[0]).toMatchObject({ text: "Yeah.", reason: "filler" });
  });

  it("does not report a wake that heard nothing as a wake-only at the next wake", () => {
    const { lines, log } = rig();
    log.event({ type: "wake", word: "Freya", score: 1.05, at: 1 });
    log.event({ type: "nothing" });
    log.event({ type: "wake", word: "Alfred", score: 0.97, at: 2 });
    expect(lines.map((line) => line["kind"])).toEqual(["nothing_heard"]);
  });

  it("never writes dictated words", () => {
    const { lines, log } = rig();
    log.event({ type: "transcript", text: "the private letter", at: 1 });
    log.event({ type: "effect", effect: { kind: "dictate", text: "the private letter" } });
    log.event({ type: "outcome", outcome: { kind: "dictated", inserted: true, reply: "" } });
    expect(JSON.stringify(lines)).not.toContain("private");
    expect(lines).toEqual([{ at: "2026-11-01T00:00:00.000Z", kind: "dictated", chars: 18 }]);
  });

  it("records the reply and any refusal reason", () => {
    const { lines, log } = rig();
    log.event({ type: "transcript", text: "delete everything", at: 1 });
    log.event({
      type: "outcome",
      outcome: { kind: "refused", reply: "I won't do that.", reason: "high_risk" },
    });
    expect(lines[0]).toMatchObject({ reply: "I won't do that.", reason: "high_risk" });
  });

  it("leaves a screen turn's line to its timings", () => {
    const { lines, log } = rig();
    log.event({ type: "transcript", text: "explain this", at: 1 });
    log.event({
      type: "outcome",
      outcome: { kind: "ran", reply: "", workSessionId: null, source: "screen" },
    });
    log.timings(timings);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: "turn", transcript: "explain this" });
  });
});
