import { describe, expect, it } from "vite-plus/test";

import { createOneShot } from "./oneShotDictation.ts";

/** Twelve minutes of dictation as the voice core delivers it: one utterance of up to 15 s each. */
const sentences = Array.from(
  { length: 48 },
  (_, i) => `Sentence number ${i + 1} of the long dictation, said at ${i * 15} seconds.`,
);

const harness = (
  clean: (raw: string) => Promise<{ text: string; stage: string } | null>,
  pastes = true,
) => {
  const saved: Array<ReadonlyArray<string>> = [];
  const pasted: string[] = [];
  const oneShot = createOneShot({
    save: (chunks) => void saved.push([...chunks]),
    clean,
    fit: async (text) => text,
    paste: async (text) => {
      if (pastes) pasted.push(text);
      return pastes;
    },
  });
  sentences.forEach((s) => oneShot.push(s));
  return { oneShot, saved, pasted };
};

describe("a twelve-minute dictation, all at once", () => {
  it("inserts every sentence once, tidied", async () => {
    const { oneShot, saved, pasted } = harness(async (raw) => ({
      text: raw.replace(/ of the long/g, ""),
      stage: "model",
    }));
    const result = await oneShot.flush();
    expect(result).toMatchObject({ status: "pasted", failed: false });
    expect(pasted).toHaveLength(1);
    for (let i = 1; i <= 48; i += 1) expect(pasted[0]).toContain(`Sentence number ${i} dictation`);
    expect(saved.at(-1)).toEqual([]);
  });

  it("inserts the raw text when the tidy-up fails, times out or comes back empty", async () => {
    for (const clean of [
      async () => null,
      async () => {
        throw new Error("timed out");
      },
      async () => ({ text: "Sentence 1.", stage: "fallback" }),
      async () => ({ text: "  ", stage: "model" }),
    ]) {
      const { oneShot, pasted } = harness(clean);
      const result = await oneShot.flush();
      expect(result).toMatchObject({ status: "pasted", failed: true });
      expect(pasted[0]).toBe(sentences.join(" "));
    }
  });

  it("keeps every chunk on disk until the paste lands, so nothing said is lost", async () => {
    const { oneShot, saved, pasted } = harness(
      async (raw) => ({ text: raw, stage: "model" }),
      false,
    );
    expect(await oneShot.flush()).toMatchObject({ status: "kept" });
    expect(pasted).toEqual([]);
    expect(saved.at(-1)).toHaveLength(48);
    expect(oneShot.pending()).toHaveLength(48);
  });
});
