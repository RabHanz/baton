// @effect-diagnostics globalDate:off
import { describe, expect, it } from "vite-plus/test";

import { parseActivity, todayStats } from "./activityLog.ts";

const at = (day: string, time: string) => new Date(`${day}T${time}`).toISOString();
const lines = [
  { at: at("2026-10-31", "09:00:00"), kind: "turn", transcript: "yesterday" },
  { at: at("2026-11-01", "09:00:00"), kind: "turn", transcript: "what is VantageOS doing" },
  { at: at("2026-11-01", "09:05:00"), kind: "dictated", chars: 120 },
  { at: at("2026-11-01", "09:06:00"), kind: "nothing_heard" },
  { at: at("2026-11-01", "09:07:00"), kind: "outcome", transcript: "x", outcome: "ok" },
]
  .map((l) => JSON.stringify(l))
  .join("\n");

describe("the history on Home", () => {
  it("lists what happened newest first, and says how much was dictated, never what", () => {
    const items = parseActivity(`${lines}\nnot json\n`);
    expect(items.map((i) => i.kind)).toEqual(["quiet", "dictated", "heard", "heard"]);
    expect(items[1]!.text).toBe("Dictated 120 characters");
    expect(items[2]!.text).toBe("what is VantageOS doing");
    expect(items[3]!.text).toBe("yesterday");
  });
  it("counts today's turns and dictations only", () => {
    const stats = todayStats(parseActivity(lines), new Date("2026-11-01T12:00:00"));
    expect(stats).toEqual({ turns: 1, dictations: 1 });
  });
});
