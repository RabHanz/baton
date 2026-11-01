import { describe, expect, it } from "vite-plus/test";

import { warmUpVoice } from "./warmUp.ts";

describe("warming the voice models before the microphone opens", () => {
  it("scores silent frames and transcribes silence, and finishes only when both have", async () => {
    const order: string[] = [];
    let frames = 0;
    let release!: () => void;
    const loaded = new Promise<void>((resolve) => (release = resolve));
    const done = warmUpVoice({
      pushFrame: () => void (frames += 1),
      transcribe: async (pcm) => {
        order.push(`transcribe ${pcm.length}`);
        await loaded;
        order.push("recogniser loaded");
        return "";
      },
      settled: async () => void order.push("scored"),
    }).then(() => order.push("ready"));
    await Promise.resolve();
    expect(order).not.toContain("ready");
    release();
    await done;
    expect(frames).toBeGreaterThan(50);
    expect(order).toEqual(["scored", "transcribe 16000", "recogniser loaded", "ready"]);
  });

  it("does not stop the start when a model fails to warm", async () => {
    await expect(
      warmUpVoice({
        pushFrame: () => {},
        transcribe: async () => {
          throw new Error("no model");
        },
        settled: async () => {},
      }),
    ).resolves.toBeUndefined();
  });
});
