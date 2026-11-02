/* oxlint-disable t3code/no-real-time-wait-in-tests -- Baton file predating the rule (D82) */
import { describe, expect, it } from "vite-plus/test";

import { createVoiceCore, type VoiceCoreEvent } from "./core.ts";

const FRAME = 320;
const frames = (seconds: number) => Math.round((seconds * 16_000) / FRAME);

const rig = (verify: (pcm: Int16Array, word: string | null) => Promise<boolean>) => {
  let fire = false;
  let speech = false;
  const heard: number[] = [];
  const events: VoiceCoreEvent[] = [];
  const core = createVoiceCore({
    waitMs: () => 0,
    verifyWake: verify,
    wake: {
      name: "fake",
      reset: () => {},
      process: () => {
        const score = fire ? 1 : null;
        fire = false;
        return score;
      },
      lastWord: () => "Sebastian",
    },
    vad: { name: "fake", reset: () => {}, isSpeech: () => speech },
    stt: {
      name: "fake",
      transcribe: async (pcm) => {
        heard.push(pcm.length);
        return "what time is it";
      },
    },
  });
  core.subscribe((event) => events.push(event));
  const push = (seconds: number) => {
    for (let i = 0; i < frames(seconds); i += 1) core.pushAudio(new Int16Array(FRAME));
  };
  return {
    core,
    push,
    events,
    heard,
    wake: () => (fire = true),
    speak: (on: boolean) => (speech = on),
  };
};

describe("the second check before a wake from sleep", () => {
  it("drops a wake the recogniser did not hear, with no wake, no cue and no turn", async () => {
    const seen: Array<[number, string | null]> = [];
    const r = rig(async (pcm, word) => {
      seen.push([pcm.length, word]);
      return false;
    });
    r.push(2);
    r.wake();
    r.push(0.1);
    await new Promise((resolve) => setImmediate(resolve));
    r.push(1);
    await r.core.idle();
    expect(seen).toHaveLength(1);
    expect(seen[0]![1]).toBe("Sebastian");
    expect(r.events.some((e) => e.type === "wake")).toBe(false);
    expect(r.events.some((e) => e.type === "dropped" && e.reason === "wake not confirmed")).toBe(
      true,
    );
    expect(r.core.snapshot().machine.mode).toBe("sleeping");
  });

  it("wakes when the check agrees, and keeps what was said after the name while it ran", async () => {
    const r = rig(async () => true);
    r.push(2);
    r.wake();
    r.push(0.1);
    r.speak(true);
    r.push(0.6);
    await new Promise((resolve) => setImmediate(resolve));
    r.push(0.2);
    expect(r.events.some((e) => e.type === "wake")).toBe(true);
    r.speak(false);
    r.push(1.2);
    await r.core.idle();
    // The utterance reaches recognition with the speech that began during the check.
    expect(r.heard.length).toBeGreaterThan(0);
    expect(Math.max(...r.heard)).toBeGreaterThan(16_000 * 0.6);
  });

  it("checks a wake that fires in an open window too, so a false fire cannot flash the pill or extend it", async () => {
    let checks = 0;
    const r = rig(async () => {
      checks += 1;
      return false;
    });
    r.core.activate("wake");
    await r.core.idle();
    const wakesBefore = r.events.filter((e) => e.type === "wake").length;
    r.wake();
    r.push(0.2);
    await new Promise((resolve) => setImmediate(resolve));
    r.push(0.2);
    expect(checks).toBe(1);
    expect(r.events.filter((e) => e.type === "wake")).toHaveLength(wakesBefore);
  });

  it("does not let its own voice barge in, and a fire over speech must be heard", async () => {
    const r = rig(async () => false);
    r.core.noteSpoken("Sebastian, your build is done");
    r.core.setSpeaking(true);
    r.push(1);
    r.wake();
    r.push(0.2);
    expect(r.events.some((e) => e.type === "barge_in" || e.type === "wake")).toBe(false);
    expect(r.events.some((e) => e.type === "dropped" && e.reason === "own voice")).toBe(true);
    const other = rig(async () => false);
    other.core.noteSpoken("The build is done");
    other.core.setSpeaking(true);
    other.push(1);
    other.wake();
    other.push(0.1);
    await new Promise((resolve) => setImmediate(resolve));
    other.push(0.2);
    expect(other.events.some((e) => e.type === "barge_in")).toBe(false);
  });
});
