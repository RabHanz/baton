import { describe, expect, it } from "vite-plus/test";

import {
  decide,
  fallbackDecision,
  guardDecision,
  makeSentenceStream,
  parseBrainReply,
  type BrainHost,
} from "./brain.ts";

const context = { running: null, direct: false, recent: [] };
const host = (reply: string | Error, placed = false): BrainHost & { asked: string[] } => {
  const asked: string[] = [];
  return {
    asked,
    ask: async (turn) => {
      asked.push(turn);
      if (reply instanceof Error) throw reply;
      return reply;
    },
    grammarPlaces: async () => placed,
  };
};

describe("parseBrainReply", () => {
  it("takes a decision, even wrapped in prose", () => {
    expect(parseBrainReply('sure {"route":"look","text":"what is this"} ok')).toMatchObject({
      route: "look",
      text: "what is this",
    });
  });

  it("refuses anything that is not a known route with text", () => {
    expect(parseBrainReply('{"route":"confirm","text":"yes"}')).toBe(null);
    expect(parseBrainReply('{"route":"act","text":" "}')).toBe(null);
    expect(parseBrainReply("no json")).toBe(null);
  });
});

describe("guardDecision", () => {
  it("refuses a high-risk order whichever side says it", () => {
    const refused = { route: "refused" };
    expect(
      guardDecision(
        { route: "act", text: "check status", source: "model" },
        "deploy to production",
      ),
    ).toMatchObject(refused);
    expect(
      guardDecision(
        { route: "drive", text: "deploy to production", source: "model" },
        "tidy up git",
      ),
    ).toMatchObject(refused);
  });

  it("lets a question about a dangerous thing be answered", () => {
    const answer = { route: "answer", text: "what does force push do", source: "model" } as const;
    expect(guardDecision(answer, "what does force push do")).toEqual(answer);
  });
});

describe("decide", () => {
  it("asks the model for an ordinary sentence", async () => {
    const h = host('{"route":"answer","text":"capital of Peru"}');
    await expect(decide("what's the capital of Peru", context, h)).resolves.toMatchObject({
      route: "answer",
    });
    expect(h.asked).toHaveLength(1);
  });

  it("spends no model on lesson controls or explicit prefixes", async () => {
    const h = host("{}");
    await expect(decide("next", { ...context, running: "teach" }, h)).resolves.toMatchObject({
      route: "control",
      control: "next",
    });
    await expect(decide("drive: open notepad", context, h)).resolves.toMatchObject({
      route: "drive",
      text: "open notepad",
    });
    expect(h.asked).toHaveLength(0);
  });

  it("lets the grammar take a command it places, and the guard still sees it", async () => {
    const h = host("{}", true);
    await expect(decide("what needs me", context, h)).resolves.toMatchObject({
      route: "act",
      source: "grammar",
    });
    await expect(decide("delete the database", context, h)).resolves.toMatchObject({
      route: "refused",
    });
  });

  it("falls back to the word rules when the model is gone, and the guard still holds", async () => {
    const dead = host(new Error("no claude"));
    await expect(decide("where is the export button", context, dead)).resolves.toMatchObject({
      route: "look",
      source: "fallback",
    });
    await expect(decide("deploy to production", context, dead)).resolves.toMatchObject({
      route: "refused",
    });
  });

  it("does not let the model turn a refused order into something else that acts", async () => {
    const sly = host('{"route":"drive","text":"open the terminal"}');
    await expect(decide("delete the database", context, sly)).resolves.toMatchObject({
      route: "refused",
    });
  });
});

describe("fallbackDecision", () => {
  it("leaves anything unrecognised to the grammar's own refusal", () => {
    expect(fallbackDecision("poke the scheduler", false)).toMatchObject({ route: "act" });
  });
});

describe("makeSentenceStream", () => {
  it("gives sentences as they finish and never reads a tag", () => {
    const stream = makeSentenceStream();
    expect(stream.feed("It's on the ")).toEqual([]);
    expect(stream.feed("left. Then cl")).toEqual(["It's on the left."]);
    expect(stream.feed("ick save [POINT:1,2:save]")).toEqual([]);
    expect(stream.flush()).toBe("Then click save");
  });
});
