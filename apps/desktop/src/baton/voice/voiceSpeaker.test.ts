// @effect-diagnostics globalTimers:off
import { describe, expect, it } from "vite-plus/test";

import { pocketPlan } from "./pocketVoice.ts";
import {
  createSpeaker,
  pcmLevel,
  speakableText,
  wavFormat,
  type VoicePlayer,
} from "./voiceSpeaker.ts";

const player: VoicePlayer = { play: async () => true, stop: () => {}, dispose: () => {} };
const drain = async (stream: AsyncIterable<Buffer>) => {
  let bytes = 0;
  for await (const chunk of stream) bytes += chunk.length;
  return bytes;
};

describe("speakableText", () => {
  it("drops markup a voice would read out", () => {
    expect(speakableText("**Done**, see `file`\n# next")).toBe("Done , see file next");
  });
});

describe("createSpeaker on the OS voice", () => {
  it("plays in order and reports active once for the whole run", async () => {
    const said: string[] = [];
    const active: boolean[] = [];
    const speaker = createSpeaker({
      os: { name: "os", speak: async (text) => void said.push(text) },
      voice: () => null,
      player,
      onActive: (value) => active.push(value),
    });
    await Promise.all([speaker.speak("one."), speaker.speak("two.")]);
    expect(said).toEqual(["one.", "two."]);
    expect(active).toEqual([true, false]);
  });

  it("drops what is queued on cancel", async () => {
    const said: string[] = [];
    const speaker = createSpeaker({
      os: { name: "os", speak: async (text) => void said.push(text) },
      voice: () => null,
      player,
    });
    const run = Promise.all([speaker.speak("one."), speaker.speak("two.")]);
    speaker.cancel();
    await run;
    expect(said).toEqual([]);
  });

  it("generates one sentence at a time, ahead of playback", async () => {
    const order: string[] = [];
    let release: (() => void) | null = null;
    const held = new Promise<void>((resolve) => (release = resolve));
    const speaker = createSpeaker({
      os: { name: "os", speak: async () => {} },
      voice: () => (text) => ({
        stream: (async function* () {
          order.push(`start ${text}`);
          if (text === "one.") await held;
          yield Buffer.alloc(2);
          order.push(`end ${text}`);
        })(),
        cancel: () => {},
      }),
      player: {
        ...player,
        play: async (wav) => {
          await drain(wav);
          return true;
        },
      },
    });
    const run = Promise.all([speaker.speak("one."), speaker.speak("two.")]);
    await new Promise((r) => setTimeout(r, 5));
    expect(order).toEqual(["start one."]);
    release!();
    await run;
    expect(order).toEqual(["start one.", "end one.", "start two.", "end two."]);
  });

  it("says nothing at all in Written only", async () => {
    const said: string[] = [];
    const active: boolean[] = [];
    const speaker = createSpeaker({
      os: { name: "os", speak: async (text) => void said.push(text) },
      voice: () => null,
      player,
      silent: () => true,
      onActive: (value) => active.push(value),
    });
    await speaker.speak("one.");
    expect(said).toEqual([]);
    expect(active).toEqual([]);
  });

  it("plays a voice's bytes and falls back to the OS voice when it fails", async () => {
    const said: string[] = [];
    const played: number[] = [];
    let fail = false;
    const speaker = createSpeaker({
      os: { name: "os", speak: async (text) => void said.push(text) },
      voice: () => () => ({
        stream: (async function* () {
          if (fail) throw new Error("no");
          yield Buffer.alloc(3);
        })(),
        cancel: () => {},
      }),
      player: {
        ...player,
        play: async (wav) => {
          const bytes = await drain(wav);
          played.push(bytes);
          return true;
        },
      },
    });
    await speaker.speak("one.");
    fail = true;
    await speaker.speak("two.");
    expect(played).toEqual([3]);
    expect(said).toEqual(["two."]);
  });
});

describe("reading a streamed WAV", () => {
  it("finds the rate and the samples in the header", () => {
    const head = Buffer.alloc(48);
    head.writeUInt32LE(24_000, 24);
    head.write("data", 36, "latin1");
    expect(wavFormat(head)).toEqual({ rate: 24_000, start: 44 });
    expect(wavFormat(Buffer.from("nope"))).toBeNull();
  });

  it("measures how loud a run of samples is", () => {
    expect(pcmLevel(Buffer.alloc(64))).toBe(0);
    const loud = Buffer.from(new Int16Array(32).fill(16_000).buffer);
    expect(pcmLevel(loud)).toBeGreaterThan(0.9);
  });
});

describe("pocketPlan", () => {
  it("fills every local path and asks only for what a voice needs", () => {
    const plan = pocketPlan("D:\\state\\pocket", "vera");
    expect(plan.config).not.toContain("{dir}");
    expect(plan.config).toContain("D:/state/pocket");
    expect(plan.files.map((f) => f.file)).toContain("vera.safetensors");
    expect(plan.files.map((f) => f.file)).not.toContain("anna.safetensors");
    expect(pocketPlan("x", "quick").files.map((f) => f.file)).toContain("tokenizer.model");
  });
});
