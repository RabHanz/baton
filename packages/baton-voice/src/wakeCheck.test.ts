/* oxlint-disable t3code/no-real-time-wait-in-tests -- Baton file predating the rule (D82) */
import { describe, expect, it } from "vite-plus/test";

import { createVoiceCore, type VoiceCoreEvent } from "./core.ts";

const FRAME = 320;
const frames = (seconds: number) => Math.round((seconds * 16_000) / FRAME);

const rig = (verify: (pcm: Int16Array, word: string | null) => Promise<boolean>) => {
  let fire = false;
  let firedAgo = 0;
  let speech = false;
  const heard: number[] = [];
  const loud: number[] = [];
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
      firedAgo: () => firedAgo,
    },
    vad: { name: "fake", reset: () => {}, isSpeech: () => speech },
    stt: {
      name: "fake",
      transcribe: async (pcm) => {
        heard.push(pcm.length);
        loud.push(pcm.filter((v) => v !== 0).length);
        return "what time is it";
      },
    },
  });
  core.subscribe((event) => events.push(event));
  const push = (seconds: number) => {
    for (let i = 0; i < frames(seconds); i += 1)
      core.pushAudio(new Int16Array(FRAME).fill(speech ? 1_000 : 0));
  };
  return {
    core,
    push,
    events,
    heard,
    loud,
    wake: (agoSeconds = 0) => {
      fire = true;
      firedAgo = Math.round(agoSeconds * 16_000);
    },
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

  it("keeps the whole command when the first check after launch is slower than the sentence", async () => {
    let confirm: (ok: boolean) => void = () => {};
    const r = rig(() => new Promise((resolve) => (confirm = resolve)));
    r.push(1);
    r.wake();
    r.speak(true);
    r.push(2);
    r.speak(false);
    // 0.1.56's first command: the check took 18 s, longer than the longest sentence.
    r.push(18);
    confirm(true);
    await new Promise((resolve) => setImmediate(resolve));
    r.push(1.2);
    await r.core.idle();
    expect(r.events.some((e) => e.type === "wake")).toBe(true);
    // All two seconds he spoke reach recognition, not the last three seconds of silence.
    expect(Math.max(0, ...r.loud)).toBeGreaterThanOrEqual(16_000 * 2);
  });

  it("places a wake the scorer reports late at the name, not at the moment the report arrives", async () => {
    const checked: number[] = [];
    const r = rig(async (pcm) => {
      checked.push(pcm.filter((v) => v !== 0).length);
      return true;
    });
    r.push(1);
    r.speak(true);
    r.push(2);
    r.speak(false);
    r.push(16);
    // The scorer was behind on the frames after launch: the name ended at 1.5 s, 17.5 s before this report.
    r.wake(17.5);
    r.push(0.1);
    await new Promise((resolve) => setImmediate(resolve));
    r.push(1.2);
    await r.core.idle();
    // The check heard the name, and recognition got the command said right after it.
    expect(checked[0]).toBeGreaterThan(0);
    expect(Math.max(0, ...r.loud)).toBeGreaterThanOrEqual(16_000 * 1.5);
    const wake = r.events.find((e) => e.type === "wake");
    expect(wake?.type === "wake" ? wake.lateMs : 0).toBeGreaterThanOrEqual(17_000);
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

/** 0.1.57 right after launch: a scripted microphone, a wake check that answers when told, and a router that records who was asked. */
const launch = () => {
  let firing: { readonly word: string; readonly ago: number } | null = null;
  let word: string | null = null;
  let ago = 0;
  const checks: Array<{ readonly word: string | null; readonly answer: (ok: boolean) => void }> =
    [];
  const routed: Array<{ readonly text: string; readonly wake: string | null | undefined }> = [];
  const events: VoiceCoreEvent[] = [];
  /** Recognition held back (the recogniser busy right after launch) until `recognise`. */
  let slow = false;
  const recognitions: Array<() => void> = [];
  /** The app stalled: frames arrive in a burst the speech detector has not scored, so it repeats its last answer. */
  let stalled = false;
  let lastSpeech = false;
  // Each sentence is its own sample value, so recognition can tell which sentences a clip holds.
  const SAID: Record<number, string> = {
    1_000: "what time is it",
    2_000: "what is the weather",
    3_000: "what needs me",
  };
  const core = createVoiceCore({
    waitMs: () => 0,
    verifyWake: (_pcm, w) => new Promise((answer) => checks.push({ word: w, answer })),
    wake: {
      name: "fake",
      reset: () => {},
      process: () => {
        if (firing === null) return null;
        ({ word, ago } = firing);
        firing = null;
        return 1;
      },
      lastWord: () => word,
      firedAgo: () => ago,
    },
    vad: {
      name: "fake",
      reset: () => {},
      isSpeech: (frame) => (stalled ? lastSpeech : (lastSpeech = frame[0] !== 0)),
      behind: () => (stalled ? 16_000 : 0),
    },
    stt: {
      name: "fake",
      transcribe: async (pcm) => {
        if (slow) await new Promise<void>((resolve) => recognitions.push(resolve));
        return [...new Set(pcm)]
          .filter((v) => v !== 0)
          .map((v) => SAID[v])
          .join(" ");
      },
    },
    router: {
      route: async (effect, context) => {
        if (effect.kind === "command") routed.push({ text: effect.text, wake: context.wake });
        return { kind: "none" };
      },
    },
  });
  core.subscribe((event) => events.push(event));
  const say = (value: number, seconds: number) => {
    for (let i = 0; i < frames(seconds); i += 1) core.pushAudio(new Int16Array(FRAME).fill(value));
  };
  return {
    core,
    events,
    routed,
    checks,
    say,
    quiet: (seconds: number) => say(0, seconds),
    /** The scorer reports a name that ended `agoSeconds` before now. */
    fire: (w: string, agoSeconds = 0) => {
      firing = { word: w, ago: Math.round(agoSeconds * 16_000) };
    },
    /** He says a name, and the scorer reports it as it ends. */
    name: (w: string, value: number) => {
      say(value, 0.5);
      firing = { word: w, ago: 0 };
    },
    confirm: (w: string) => checks.find((c) => c.word === w)?.answer(true),
    slowRecognition: () => (slow = true),
    recognise: () => {
      slow = false;
      recognitions.splice(0).forEach((resolve) => resolve());
    },
    stall: (on: boolean) => (stalled = on),
    settle: async () => {
      for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
    },
  };
};

describe("right after launch, when the wake check is slow", () => {
  it("answers a name said while the first check still runs, as that name, with only its own sentence", async () => {
    const r = launch();
    r.quiet(1);
    r.name("Freya", 1_000);
    r.say(1_000, 1.4);
    r.quiet(3);
    r.name("Alfred", 2_000);
    r.say(2_000, 1.4);
    r.quiet(2);
    r.confirm("Freya");
    r.confirm("Alfred");
    await r.settle();
    r.quiet(2);
    await r.core.idle();
    expect(r.routed).toEqual([
      { text: "what time is it", wake: "Freya" },
      { text: "what is the weather", wake: "Alfred" },
    ]);
  });

  it("answers each sentence once, as the name said before it, when a name lands in the last one's open window", async () => {
    const r = launch();
    r.quiet(1);
    r.name("Freya", 1_000);
    r.say(1_000, 1.4);
    r.quiet(3);
    r.confirm("Freya");
    await r.settle();
    r.quiet(1);
    // Her window is open; his check is still running when his sentence ends.
    r.name("Alfred", 2_000);
    r.say(2_000, 1.4);
    r.quiet(2);
    await r.settle();
    r.confirm("Alfred");
    await r.settle();
    r.quiet(2);
    await r.core.idle();
    expect(r.routed).toEqual([
      { text: "what time is it", wake: "Freya" },
      { text: "what is the weather", wake: "Alfred" },
    ]);
  });

  it("answers a sentence whose recognition comes back after its window would have closed", async () => {
    const r = launch();
    r.quiet(4.4);
    r.name("Freya", 1_000);
    r.say(1_000, 1.4);
    r.quiet(2);
    // 0.1.59: the check took 28 s, and the sentence then waited another 20 s behind the next check.
    r.slowRecognition();
    r.quiet(26);
    r.confirm("Freya");
    await r.settle();
    r.quiet(20);
    r.recognise();
    await r.settle();
    r.quiet(1);
    await r.core.idle();
    expect(r.routed).toEqual([{ text: "what time is it", wake: "Freya" }]);
  });

  it("does not end the sentence after a name on frames the speech detector has not scored", async () => {
    const r = launch();
    r.quiet(4.4);
    r.name("Freya", 1_000);
    r.quiet(0.15);
    // The app stalls as the sentence starts: its frames arrive in a burst, and the detector still says silence.
    r.stall(true);
    r.say(1_000, 1.4);
    r.stall(false);
    r.quiet(2);
    r.confirm("Freya");
    await r.settle();
    r.quiet(1);
    await r.core.idle();
    expect(r.events.some((e) => e.type === "dropped" && e.reason === "no speech")).toBe(false);
    expect(r.routed).toEqual([{ text: "what time is it", wake: "Freya" }]);
  });

  it("takes a name said after her voice stopped as his, though the scorer reports it while she speaks again", async () => {
    const r = launch();
    r.core.noteSpoken("Freya here. It is seven in the morning.");
    r.core.setSpeaking(true);
    r.quiet(2);
    r.core.setSpeaking(false);
    r.quiet(1);
    r.say(3_000, 0.5);
    r.quiet(0.5);
    r.core.setSpeaking(true);
    r.quiet(0.5);
    r.fire("Freya", 1);
    r.quiet(0.2);
    r.confirm("Freya");
    await r.settle();
    r.quiet(0.2);
    expect(r.events.some((e) => e.type === "dropped" && e.reason === "own voice")).toBe(false);
    expect(r.events.some((e) => e.type === "wake" && e.word === "Freya")).toBe(true);
  });
});
