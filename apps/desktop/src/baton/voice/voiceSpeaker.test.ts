import { describe, expect, it } from "vite-plus/test";

import { createSpeaker, speakableText, wavEnvelope, type VoicePlayer } from "./voiceSpeaker.ts";

const player: VoicePlayer = { play: async () => {}, stop: () => {}, dispose: () => {} };

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
        result: fail ? Promise.reject(new Error("no")) : Promise.resolve(Buffer.alloc(3)),
        cancel: () => {},
      }),
      player: { ...player, play: async (wav) => void played.push(wav.length) },
    });
    await speaker.speak("one.");
    fail = true;
    await speaker.speak("two.");
    expect(played).toEqual([3]);
    expect(said).toEqual(["two."]);
  });
});

describe("wavEnvelope", () => {
  const wav = (samples: Int16Array, rate = 22_050) => {
    const header = Buffer.alloc(44);
    header.write("RIFF", 0, "latin1");
    header.write("WAVEfmt ", 8, "latin1");
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(rate, 24);
    header.write("data", 36, "latin1");
    return Buffer.concat([header, Buffer.from(samples.buffer)]);
  };

  it("follows the loudness of the speech", () => {
    const loud = new Int16Array(882).fill(16_000);
    const quiet = new Int16Array(882);
    const envelope = wavEnvelope(wav(new Int16Array([...quiet, ...loud])));
    expect(envelope).toHaveLength(2);
    expect(envelope[0]).toBe(0);
    expect(envelope[1]).toBeGreaterThan(0.9);
  });

  it("is empty for bytes that are not a WAV", () => {
    expect(wavEnvelope(Buffer.from("nope"))).toEqual([]);
  });
});
