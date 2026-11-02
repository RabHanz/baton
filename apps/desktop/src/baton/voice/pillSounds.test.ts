import { describe, expect, it } from "vite-plus/test";

import { PILL_SOUNDS, renderSound, soundMs, type PillSound } from "./pillSounds.ts";

describe("the cue sounds", () => {
  const all = Object.keys(PILL_SOUNDS) as PillSound[];

  it("are short, quiet and never clip, so none can distort", () => {
    for (const name of all) {
      const samples = renderSound(PILL_SOUNDS[name], 48_000);
      const peak = samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
      expect(peak, name).toBeLessThan(0.2);
      expect(soundMs(name), name).toBeLessThanOrEqual(600);
    }
  });

  it("say what happened by their shape: start rises, an error falls, finished resolves upward in three", () => {
    const hz = (name: PillSound) => PILL_SOUNDS[name].map((n) => n.hz);
    expect(hz("start")[1]!).toBeGreaterThan(hz("start")[0]!);
    expect(hz("error")[1]!).toBeLessThan(hz("error")[0]!);
    expect(hz("finished")).toHaveLength(3);
    expect(hz("finished")[2]!).toBeGreaterThan(hz("finished")[0]!);
    expect(PILL_SOUNDS.stepDone).toHaveLength(1);
    expect(PILL_SOUNDS.waiting).toHaveLength(1);
  });
});
