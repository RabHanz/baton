import { describe, expect, it } from "vite-plus/test";

import { compactQuiet, holdFramesUntil, startWarmUp, warmUpVoice } from "./warmUp.ts";

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
    expect(order.slice(0, 3)).toEqual(["scored", "transcribe 16000 true", "recogniser loaded"]);
    expect(order).toContain("ready");
  });

  it("then runs longer clips, one at a time, so the first real sentence is not the first long one", async () => {
    const lengths: number[] = [];
    const longer: number[] = [];
    let last!: () => void;
    const finished = new Promise<void>((resolve) => (last = resolve));
    const ready = await warmUpVoice({
      pushFrame: () => {},
      transcribe: async (pcm) => {
        lengths.push(pcm.length / 16_000);
        return "";
      },
      settled: async () => {},
      onLonger: (seconds) => {
        longer.push(seconds);
        if (longer.length === 2) last();
      },
    });
    expect(ready).toBe(true);
    await finished;
    expect(lengths).toEqual([1, 4, 8]);
    expect(longer).toEqual([4, 8]);
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
  const frame = (n: number, loud = true) =>
    Int16Array.from({ length: 320 }, () => (loud ? n * 1000 : 0));

  it("plays the held audio in order, at twice the speed it was said, then passes frames straight through", async () => {
    const got: number[] = [];
    const slept: number[] = [];
    let go!: () => void;
    const ready = new Promise<void>((resolve) => (go = resolve));
    let finished!: () => void;
    const drained = new Promise<void>((resolve) => (finished = resolve));
    const core = { pushAudio: (f: Int16Array) => void got.push(f[0]! / 1000), other: () => "kept" };
    const held = holdFramesUntil(core, ready, 15_000, {
      sleep: async (ms) => void slept.push(ms),
      played: () => queueMicrotask(() => void 0),
    });
    held.pushAudio(frame(1));
    held.pushAudio(frame(2));
    expect(got).toEqual([]);
    go();
    await ready;
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    held.pushAudio(frame(3));
    finished();
    await drained;
    expect(got).toEqual([1, 2, 3]);
    expect(slept).toEqual([10, 10]);
    expect(held.other()).toBe("kept");
  });

  it("keeps frames that arrive while it plays, in order", async () => {
    const got: number[] = [];
    let go!: () => void;
    const ready = new Promise<void>((resolve) => (go = resolve));
    let held!: { pushAudio: (f: Int16Array) => void };
    const core = { pushAudio: (f: Int16Array) => void got.push(f[0]! / 1000) };
    held = holdFramesUntil(core, ready, 15_000, {
      sleep: async () => {
        // Time passes during the replay: a live frame arrives.
        if (!got.includes(9)) held.pushAudio(frame(9));
      },
    });
    held.pushAudio(frame(1));
    go();
    await ready;
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    expect(got).toEqual([1, 9]);
  });

  it("keeps only the newest frames when the wait is very long", async () => {
    const got: number[] = [];
    let go!: () => void;
    const ready = new Promise<void>((resolve) => (go = resolve));
    const held = holdFramesUntil(
      { pushAudio: (f: Int16Array) => void got.push(f[0]! / 1000) },
      ready,
      2,
      { sleep: async () => {} },
    );
    for (const n of [1, 2, 3, 4]) held.pushAudio(frame(n));
    go();
    await ready;
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    expect(got).toEqual([3, 4]);
  });

  it("catches up with the microphone after playing in what it held, instead of staying behind it", async () => {
    const at: number[] = [];
    let go!: () => void;
    const ready = new Promise<void>((resolve) => (go = resolve));
    let clock = 0;
    let due = 0;
    let held!: { pushAudio: (f: Int16Array) => void };
    held = holdFramesUntil({ pushAudio: () => void at.push(clock) }, ready, 15_000, {
      sleep: async (ms) => {
        clock += ms;
        // The microphone delivers a frame every 20 ms meanwhile, for ten seconds.
        while (due + 20 <= clock && due < 10_000) {
          due += 20;
          held.pushAudio(frame(1));
        }
      },
    });
    // Two seconds said before the models were ready.
    for (let i = 0; i < 100; i += 1) held.pushAudio(frame(1));
    go();
    await ready;
    for (let i = 0; i < 20_000; i += 1) await Promise.resolve();
    // Live again well before the microphone stopped, not two seconds behind it for good.
    expect(Math.max(...at)).toBeLessThan(6_000);
    const before = at.length;
    held.pushAudio(frame(1));
    expect(at).toHaveLength(before + 1);
  });

  it("cuts a long quiet stretch to 1.2 s so the replay does not wait through minutes of silence", () => {
    const speech = frame(1);
    const quiet = frame(0, false);
    const frames = [speech, ...Array.from({ length: 3_000 }, () => quiet), speech];
    const out = compactQuiet(frames);
    expect(out.length).toBe(2 + 60);
    expect(out[0]).toBe(speech);
    expect(out.at(-1)).toBe(speech);
  });
});
