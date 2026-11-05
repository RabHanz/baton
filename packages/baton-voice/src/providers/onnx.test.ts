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
});
