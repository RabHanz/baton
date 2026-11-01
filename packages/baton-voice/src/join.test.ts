import { describe, expect, it } from "vite-plus/test";

import { createVoiceCore, type VoiceCoreEvent } from "./core.ts";
import type { RouteOutcome } from "./router.ts";

const FRAME = 320;
const frames = (seconds: number) => Math.round((seconds * 16_000) / FRAME);

/** Scripted speech: `say` pushes loud frames, `quiet` pushes silence; recognition returns the next line. */
const rig = (lines: ReadonlyArray<string>, reply?: Promise<void>) => {
  let speech = false;
  let next = 0;
  const routed: string[] = [];
  const events: VoiceCoreEvent[] = [];
  const core = createVoiceCore({
    waitMs: () => 1_500,
    wake: { name: "fake", reset: () => {}, process: () => null },
    vad: { name: "fake", reset: () => {}, isSpeech: () => speech },
    stt: { name: "fake", transcribe: async () => lines[next++] ?? "" },
    router: {
      route: async (effect): Promise<RouteOutcome> => {
        if (effect.kind !== "command") return { kind: "none" };
        routed.push(effect.text);
        await reply;
        return { kind: "ran", reply: "ok", workSessionId: null, source: "test" };
      },
    },
  });
  core.subscribe((event) => events.push(event));
  const push = (seconds: number, loud: boolean) => {
    speech = loud;
    for (let i = 0; i < frames(seconds); i += 1) core.pushAudio(new Int16Array(FRAME));
  };
  const settle = async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r));
  };
  return { core, push, routed, events, settle };
};

describe("one sentence with a breath in it", () => {
  it("joins speech that resumes inside the pause into one turn", async () => {
    const r = rig(["There's still many", "Experience problems."]);
    r.core.activate("wake");
    await r.core.idle();
    r.push(1, true);
    r.push(1, false); // a breath: the first pause passes, the turn is not over
    await r.settle();
    r.push(0.6, false);
    r.push(1, true);
    r.push(0.8, false);
    await r.settle();
    r.push(3, false);
    await r.settle();
    await r.core.idle();
    expect(r.routed).toEqual(["There's still many Experience problems."]);
  });

  it("answers a finished question without waiting out the long pause", async () => {
    const r = rig(["What time is it?"]);
    r.core.activate("wake");
    await r.core.idle();
    r.push(1, true);
    r.push(1.2, false);
    await r.settle();
    r.push(0.2, false);
    await r.core.idle();
    expect(r.routed).toEqual(["What time is it?"]);
  });

  it("cancels a reply in progress when the rest arrives", async () => {
    let finish: () => void = () => {};
    const r = rig(
      ["Tell me the weather in Paris.", "And in Rome."],
      new Promise<void>((res) => (finish = res)),
    );
    r.core.activate("wake");
    await r.core.idle();
    r.push(1, true);
    r.push(1.2, false); // finished words: the router is asked after the short pause
    await r.settle();
    r.push(0.3, false);
    r.push(1, true);
    r.push(1, false);
    await r.settle();
    finish();
    r.push(3, false);
    await r.settle();
    await r.core.idle();
    expect(r.routed).toEqual([
      "Tell me the weather in Paris.",
      "Tell me the weather in Paris. And in Rome.",
    ]);
    expect(r.events.filter((e) => e.type === "outcome")).toHaveLength(1);
  });

  it("lets a statement in the follow-up window go in silence, and takes a question", async () => {
    const r = rig([
      "What time is it?",
      "Alfonso thinks the festival starts at eight",
      "And in Rome?",
    ]);
    r.core.activate("wake");
    await r.core.idle();
    for (const _ of [0, 1, 2]) {
      r.push(1, true);
      r.push(1.2, false);
      await r.settle();
      r.push(1, false);
      await r.settle();
      await r.core.idle();
    }
    expect(r.routed).toEqual(["What time is it?", "And in Rome?"]);
    expect(r.events.some((e) => e.type === "dropped" && e.reason === "not addressed")).toBe(true);
  });

  it("ends the window on a dismissal with no router call", async () => {
    const r = rig(["Nothing, dismiss."]);
    r.core.activate("wake");
    await r.core.idle();
    r.push(1, true);
    r.push(1, false);
    await r.settle();
    await r.core.idle();
    expect(r.routed).toEqual([]);
    expect(r.events.some((e) => e.type === "dismissed")).toBe(true);
    expect(r.core.snapshot().machine.mode).toBe("sleeping");
  });
});
