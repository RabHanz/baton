import type { BatonFleetEntry } from "@t3tools/baton-contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { describeWatch, watchFleet } from "./watch.ts";

const NOW = Date.parse("2026-11-02T12:00:00.000Z");
const ago = (min: number) => DateTime.formatIso(DateTime.makeUnsafe(NOW - min * 60_000));
const entry = (id: string, state: string, minutes: number, over: object = {}) =>
  ({
    workSessionId: id,
    title: `Work ${id}`,
    lifecycle: "active",
    state,
    updatedAt: ago(minutes),
    threads: [],
    synopsis: null,
    ...over,
  }) as unknown as BatonFleetEntry;

describe("watching the fleet", () => {
  it("flags what state says is wrong or left alone, worst first, and nothing else", () => {
    const found = watchFleet(
      [
        entry("ok", "working", 5),
        entry("slow", "working", 50),
        entry("ask", "needs_input", 45),
        entry("freshAsk", "needs_input", 5),
        entry("bad", "failed", 2, {
          synopsis: { currentAction: "ran the tests", recentFindings: [] },
        }),
        entry("seen", "done_unseen", 300),
        entry("fresh", "done_unseen", 10),
        entry("settled", "failed", 90, { lifecycle: "settled" }),
        entry("idle", "idle", 9999),
      ],
      NOW,
    );
    expect(found.map((f) => `${f.workSessionId}:${f.kind}`)).toEqual([
      "bad:failed",
      "slow:stalled",
      "ask:unanswered",
      "seen:unseen",
    ]);
    expect(found[0]?.lastDid).toBe("ran the tests");
  });
  it("counts a thread's own activity, so a busy thread is not stalled", () => {
    const e = entry("busy", "working", 90, { threads: [{ lastActivityAt: ago(3) }] });
    expect(watchFleet([e], NOW)).toEqual([]);
  });
  it("says so when nothing is wrong", () => {
    expect(describeWatch([])).toBe("Nothing is being left alone.");
    expect(describeWatch(watchFleet([entry("bad", "failed", 130)], NOW))).toBe(
      "Work bad failed (2 h) [id: bad]",
    );
  });
});
