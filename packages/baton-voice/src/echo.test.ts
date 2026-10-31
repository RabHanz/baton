import { describe, expect, it } from "vite-plus/test";

import { createVoiceCore, type VoiceCoreEvent } from "./core.ts";

const FRAME = 512;
const frames = (seconds: number) => Math.ceil((seconds * 16_000) / FRAME);

/** Wakes on demand, hears speech on every frame, and transcribes whatever reaches it. */
const rig = () => {
  let fire = false;
  const heard: number[] = [];
  const events: VoiceCoreEvent[] = [];
  const core = createVoiceCore({
    wake: {
      name: "fake",
      reset: () => {},
      process: () => {
        const score = fire ? 1 : null;
        fire = false;
        return score;
      },
    },
    vad: { name: "fake", reset: () => {}, isSpeech: () => true },
    stt: {
      name: "fake",
      transcribe: async (pcm) => {
        heard.push(pcm.length);
        return "something he said";
      },
    },
  });
  core.subscribe((event) => events.push(event));
  const push = (seconds: number) => {
    for (let i = 0; i < frames(seconds); i += 1) core.pushAudio(new Int16Array(FRAME));
  };
  return { core, push, heard, events, wake: () => (fire = true) };
};

describe("Baton hearing itself", () => {
  it("starts no turn from its own voice in a conversation window", async () => {
    const r = rig();
    r.core.activate("wake");
    await r.core.idle();
    r.core.setSpeaking(true);
    r.push(12);
    r.core.setSpeaking(false);
    r.push(0.3);
    await r.core.idle();
    expect(r.heard).toEqual([]);
    expect(r.events.some((e) => e.type === "transcript")).toBe(false);
  });

  it("lets a real wake word cut in, and then listens", async () => {
    const r = rig();
    r.core.setSpeaking(true);
    r.push(1);
    r.wake();
    r.push(1);
    expect(r.events.some((e) => e.type === "barge_in")).toBe(true);
    expect(r.events.some((e) => e.type === "wake")).toBe(true);
    r.push(16);
    await r.core.idle();
    expect(r.heard.length).toBeGreaterThan(0);
  });

  it("hears him again once the echo has gone", async () => {
    const r = rig();
    r.core.activate("wake");
    await r.core.idle();
    r.core.setSpeaking(true);
    r.push(1);
    r.core.setSpeaking(false);
    r.push(0.6);
    r.push(16);
    await r.core.idle();
    expect(r.heard.length).toBeGreaterThan(0);
  });
});

describe("a wake word over a long reply", () => {
  it("keeps what he says next, though the next sentence starts", async () => {
    const r = rig();
    r.core.setSpeaking(true);
    r.push(1);
    r.wake();
    r.push(0.2);
    // The rest of the reply's queue ending, or one more sentence starting.
    r.core.setSpeaking(true);
    r.core.setSpeaking(false);
    r.push(16);
    await r.core.idle();
    expect(r.heard.length).toBeGreaterThan(0);
    expect(r.heard[0]! / 16_000).toBeGreaterThan(5);
  });
});

describe("a pending yes, with Baton talking over it", () => {
  const rigged = (heard: string) => {
    let fire = false;
    let speech = true;
    const effects: string[] = [];
    const core = createVoiceCore({
      wake: {
        name: "fake",
        reset: () => {},
        process: () => {
          const score = fire ? 1 : null;
          fire = false;
          return score;
        },
      },
      vad: { name: "fake", reset: () => {}, isSpeech: () => speech },
      stt: { name: "fake", transcribe: async () => heard },
      router: {
        route: async (effect) => {
          effects.push(effect.kind);
          return effect.kind === "command"
            ? { kind: "needs_confirmation", token: "t", prompt: "Sure?", workSessionId: null }
            : { kind: "none" };
        },
      },
    });
    const push = (seconds: number) => {
      for (let i = 0; i < frames(seconds); i += 1) core.pushAudio(new Int16Array(FRAME));
    };
    return {
      core,
      push,
      effects,
      wake: () => (fire = true),
      quiet: () => (speech = false),
    };
  };
  const overItsVoice = async (r: ReturnType<typeof rigged>) => {
    r.core.activate("wake");
    await r.core.idle();
    await r.core.hear("send it to backend");
    await r.core.idle();
    r.core.setSpeaking(true);
    r.push(0.5);
    r.wake();
    r.push(1);
    // He stops talking: inside the window, so the question has not run out.
    r.quiet();
    r.push(1.5);
    await r.core.idle();
  };

  it("ignores a confirm that started over its voice", async () => {
    const r = rigged("Freya, confirm.");
    await overItsVoice(r);
    expect(r.effects).not.toContain("confirmed");
  });

  it("still hears cancel", async () => {
    const r = rigged("cancel");
    await overItsVoice(r);
    expect(r.effects).toContain("cancelled");
  });
});

describe("speech that starts while he is cutting in", () => {
  it("closes the gate when his words end", async () => {
    const r = rig();
    r.core.setSpeaking(true);
    r.push(1);
    r.wake();
    r.push(0.2);
    r.core.setSpeaking(true);
    r.push(16);
    await r.core.idle();
    const after = r.heard.length;
    r.push(16);
    await r.core.idle();
    expect(r.heard.length).toBe(after);
  });
});
