import { describe, expect, it } from "vite-plus/test";

import { commitMs, isUnfinished, JOIN_WITHIN_MS } from "./endOfTurn.ts";

/** Splits in his log of 2026-11-01: pauses are speech_end gaps minus the later part's estimated length. */
const FIRST_PAUSE_MS = 560;
const split = [
  { first: "There's still many", pauseMs: 1_500 },
  { first: "Textbox on screen.", pauseMs: 1_100 },
  { first: "Can you tell me what's the", pauseMs: 1_700 },
];

describe("end of turn", () => {
  it("reads unfinished and finished words", () => {
    for (const t of [
      "There's still many",
      "Can you tell me what's the",
      "and",
      "so,",
      "I think that",
      "Look. What?",
      "Right.",
      "So, what",
    ])
      expect(isUnfinished(t)).toBe(true);
    for (const t of [
      "What time is it?",
      "Where is Peru?",
      "Textbox on screen.",
      "Look at the screen.",
      "So what needs me today?",
    ])
      expect(isUnfinished(t)).toBe(false);
  });

  it("waits longer on unfinished words and less on a finished question", () => {
    expect(commitMs(1_500, "There's still many")).toBeGreaterThan(
      commitMs(1_500, "Tell me the time now please ok"),
    );
    expect(commitMs(1_500, "What time is it?")).toBeLessThan(1_500);
  });

  it("splits none of his logged turns, where the old fixed 0.8 s split them", () => {
    let before = 0;
    let after = 0;
    for (const s of split) {
      if (s.pauseMs + FIRST_PAUSE_MS > 800) before += 1;
      // Held until the commit point, or joined if the rest starts within the join window.
      const held = commitMs(1_500, s.first) - FIRST_PAUSE_MS;
      if (s.pauseMs > held && s.pauseMs + FIRST_PAUSE_MS > JOIN_WITHIN_MS) after += 1;
    }
    expect(before).toBe(3);
    expect(after).toBe(0);
  });
});
