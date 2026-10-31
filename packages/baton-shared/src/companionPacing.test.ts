import { describe, expect, it } from "vite-plus/test";

import { AFTER_SPEECH_MS, holdAfterSpeechMs, pageText, readingMs } from "./companionPacing.ts";

describe("how long things stay up", () => {
  it("never shows anything for less than a glance, and grows with the words", () => {
    expect(readingMs("Yes.")).toBe(3_000);
    expect(readingMs("word ".repeat(100))).toBeGreaterThan(25_000);
  });

  it("holds after speech for at least the floor, longer if reading takes longer", () => {
    expect(holdAfterSpeechMs("Short.", 2_000)).toBe(AFTER_SPEECH_MS);
    expect(holdAfterSpeechMs("word ".repeat(100), 1_000)).toBeGreaterThan(20_000);
  });

  it("breaks long text between sentences and loses none of it", () => {
    const text = Array.from({ length: 12 }, (_, i) => `This is sentence ${i} of the answer.`).join(
      " ",
    );
    const pages = pageText(text, 100);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every((p) => p.endsWith("."))).toBe(true);
    expect(pages.join(" ")).toBe(text);
  });

  it("keeps a single sentence longer than a page whole", () => {
    const long = `${"word ".repeat(40).trim()}.`;
    expect(pageText(long, 50)).toEqual([long]);
  });
});
