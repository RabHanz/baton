import { describe, expect, it } from "vite-plus/test";

import { streamingScorer } from "./onnx.ts";

describe("streamingScorer", () => {
  it("reports how far behind the newest frame a late fire was", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let chunks = 0;
    const s = streamingScorer({
      name: "fake",
      chunkSamples: 1280,
      reset: () => {},
      threshold: 1,
      // The second chunk is the name; scoring is stuck behind a slow first run until released.
      score: async () => {
        chunks += 1;
        await gate;
        return chunks === 2 ? 1 : 0;
      },
    });
    for (let i = 0; i < 20; i += 1) s.feed(new Int16Array(320));
    release();
    await s.drain();
    expect(s.take()).toBe(1);
    expect(s.firedAgo()).toBe(20 * 320 - 2 * 1280);
  });

  it("catches up after a stall instead of scoring a backlog of old audio", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let scored = 0;
    let resets = 0;
    const s = streamingScorer({
      name: "fake",
      chunkSamples: 1280,
      reset: () => void (resets += 1),
      threshold: 1,
      score: async () => {
        await gate;
        scored += 1;
        return 0;
      },
    });
    // Models still loading at launch: 20 s of audio arrives before the first score returns.
    for (let i = 0; i < 1_000; i += 1) s.feed(new Int16Array(320));
    release();
    await s.drain();
    // Only the newest few seconds (plus the chunk already running) are scored, from a fresh start.
    expect(scored).toBeLessThanOrEqual(1 + 4 * (16_000 / 1280));
    expect(resets).toBe(1);
  });
});
