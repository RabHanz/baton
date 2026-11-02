import { describe, expect, it } from "vite-plus/test";

import { holdFramesUntil, startWarmUp, warmUpVoice } from "./warmUp.ts";

describe("warming the voice models before the microphone opens", () => {
  it("scores silent frames and transcribes silence, and finishes only when both have", async () => {
    const order: string[] = [];
    let frames = 0;
    let release!: () => void;
    const loaded = new Promise<void>((resolve) => (release = resolve));
    const done = warmUpVoice({
      pushFrame: () => void (frames += 1),
      transcribe: async (pcm) => {
        order.push(`transcribe ${pcm.length} ${pcm.some((v) => v !== 0)}`);
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
    expect(order).toEqual(["scored", "transcribe 16000 true", "recogniser loaded", "ready"]);
  });

  it("reports each stage as it finishes, so a slow start can say how far it is", async () => {
    const seen: Array<[number, number]> = [];
    await warmUpVoice({
      pushFrame: () => {},
      transcribe: async () => "",
      settled: async () => {},
      onStage: (ready, total) => void seen.push([ready, total]),
    });
    expect(seen).toEqual([
      [1, 2],
      [2, 2],
    ]);
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
    ).resolves.toBe(false);
  });

  it("finishes at its limit when the recogniser never answers for silence (0.1.30 hung here)", async () => {
    let giveUp!: () => void;
    const limit = new Promise<void>((resolve) => (giveUp = resolve));
    const order: string[] = [];
    const warm = warmUpVoice({
      pushFrame: () => {},
      transcribe: () => new Promise<string>(() => {}),
      settled: () => new Promise<void>(() => {}),
      limit: () => limit,
    }).then((finished) => order.push(finished ? "over" : "gave up"));
    await Promise.resolve();
    expect(order).toEqual([]);
    giveUp();
    await warm;
    expect(order).toEqual(["gave up"]);
  });

  it("keeps the models loading after the limit and says when they are really ready", async () => {
    let load!: () => void;
    const loaded = new Promise<void>((resolve) => (load = resolve));
    const warm = startWarmUp({
      pushFrame: () => {},
      transcribe: async () => (await loaded, ""),
      settled: async () => {},
      limit: async () => {},
    });
    expect(await warm.result).toBe(false);
    let complete = false;
    void warm.complete.then(() => (complete = true));
    await Promise.resolve();
    expect(complete).toBe(false);
    load();
    await warm.complete;
    expect(complete).toBe(true);
  });
});

describe("holding what is heard while the models load", () => {
  it("plays the held audio in order once ready, then passes frames straight through", async () => {
    const got: number[] = [];
    let go!: () => void;
    const ready = new Promise<void>((resolve) => (go = resolve));
    const core = { pushAudio: (f: Int16Array) => void got.push(f[0]!), other: () => "kept" };
    const held = holdFramesUntil(core, ready);
    held.pushAudio(Int16Array.of(1));
    held.pushAudio(Int16Array.of(2));
    expect(got).toEqual([]);
    go();
    await ready;
    await Promise.resolve();
    held.pushAudio(Int16Array.of(3));
    expect(got).toEqual([1, 2, 3]);
    expect(held.other()).toBe("kept");
  });

  it("keeps only the newest frames when the wait is very long", async () => {
    const got: number[] = [];
    let go!: () => void;
    const ready = new Promise<void>((resolve) => (go = resolve));
    const held = holdFramesUntil({ pushAudio: (f: Int16Array) => void got.push(f[0]!) }, ready, 2);
    for (const n of [1, 2, 3, 4]) held.pushAudio(Int16Array.of(n));
    go();
    await ready;
    await Promise.resolve();
    expect(got).toEqual([3, 4]);
  });
});
