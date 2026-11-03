import { describe, expect, it } from "vite-plus/test";

import { createEchoGuard } from "./echoGuard.ts";
import { runEcho, speechLike } from "./echoSim.ts";

describe("the echo guard", () => {
  it("says nothing, and trusts nothing, until it has learned the room", () => {
    const guard = createEchoGuard();
    const loud = Int16Array.from({ length: 320 }, (_, i) => Math.round(8000 * Math.sin(i / 5)));
    expect(guard.process(loud, 20)).toMatchObject({ ready: false, nearEnd: false });
  });

  it("learns the delay and cuts the echo within a second or two of speech", () => {
    const run = runEcho({ tts: speechLike(12, 7, 110), seed: 3, unknownDelayMs: 140, rt60Ms: 250, echoRms: 0.07, noiseRms: 0.002, interruptions: [] });
    expect(run.readyAtS).not.toBeNull();
    expect(run.readyAtS!).toBeLessThan(4);
  });

  it("hears a loud interruption over the echo, quickly", () => {
    const run = runEcho({
      tts: speechLike(30, 7, 110),
      seed: 3,
      unknownDelayMs: 140,
      rt60Ms: 250,
      echoRms: 0.07,
      noiseRms: 0.002,
      frames: 6,
      interruptions: [{ atS: 15, seconds: 2, overEchoDb: 12, pitchHz: 190 }],
    });
    const heard = run.detections.filter((t) => t >= 15);
    expect(heard[0]).toBeDefined();
    // Onset to detection: the 120 ms confirmation and a frame or two.
    expect(heard[0]! - 15).toBeLessThan(0.5);
  });
});
