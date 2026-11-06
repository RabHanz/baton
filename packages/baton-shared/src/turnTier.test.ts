import { describe, expect, it } from "vite-plus/test";

import { chooseTurnBrain, tierBrains, tierOfSentence } from "./turnTier.ts";

const opus = { model: "opus", effort: "medium" };
const sonnet = { model: "sonnet", effort: "medium" };

describe("which model answers a chat turn", () => {
  it.each([
    ["What time is it?", "fast"],
    ["what needs me?", "fast"],
    ["look, what needs me today?", "fast"],
    ["is anything stuck?", "fast"],
    ["what's the capital of Peru?", "fast"],
    ["thanks", "fast"],
    ["Can you tell me what's on my screen?", "default"],
    ["remind me to check the deploy in an hour", "default"],
    ["tell the build session to rerun the tests", "default"],
    ["dictation apps, which one's best?", "default"],
    ["turn on word wrap in notepad for me", "deep"],
    ["take on a job: tidy the README in the shop project", "deep"],
    ["the shop README job is agreed: give the copy to marketing", "deep"],
    ["what did your standing jobs do today?", "fast"],
    ["type hello world into notepad and save it", "deep"],
    ["should I move the launch to Friday?", "deep"],
  ])("%s -> %s", (said, tier) => {
    expect(tierOfSentence(said).tier).toBe(tier);
  });

  it("never runs above the persona's model, and keeps a model it does not know", () => {
    expect(chooseTurnBrain("what time is it", opus)).toMatchObject({
      tier: "fast",
      brain: { model: "haiku", effort: "low" },
    });
    expect(chooseTurnBrain("what's on my screen", opus).brain).toEqual(sonnet);
    expect(chooseTurnBrain("plan my week", opus).brain).toEqual(opus);
    expect(chooseTurnBrain("plan my week", sonnet)).toMatchObject({
      tier: "default",
      brain: sonnet,
    });
    const custom = { model: "claude-custom-1", effort: "high" };
    expect(chooseTurnBrain("what time is it", custom).brain).toEqual(custom);
  });

  it("carries out a yes on the model that asked for it", () => {
    expect(chooseTurnBrain("yes, go ahead", opus, "deep").brain).toEqual(opus);
    expect(chooseTurnBrain("yes, go ahead", opus).tier).toBe("fast");
    expect(chooseTurnBrain("what time is it", opus, "deep").tier).toBe("fast");
  });

  it("warms every model a persona's turns can land on", () => {
    expect(tierBrains(opus).map((b) => b.model)).toEqual(["haiku", "sonnet", "opus"]);
    expect(tierBrains(sonnet)).toEqual([{ model: "haiku", effort: "low" }, sonnet]);
  });
});
