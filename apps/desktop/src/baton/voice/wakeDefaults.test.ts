import { describe, expect, it } from "vite-plus/test";

import { FRESH_WAKE_WORDS, wakeWordsFor } from "./wakeDefaults.ts";

const enabled = (words: ReadonlyArray<{ word: string; enabled: boolean }>) =>
  words.filter((w) => w.enabled).map((w) => w.word);

describe("wake words at start", () => {
  it("gives a fresh install Tessaya, Alfred and Freya, all on", () => {
    expect(enabled(wakeWordsFor(null))).toEqual(["Tessaya", "Alfred", "Freya"]);
    expect(wakeWordsFor(null)).toBe(FRESH_WAKE_WORDS);
  });
  it("keeps Freya for a settings file from before the list was saved", () => {
    expect(enabled(wakeWordsFor({ enabled: true, sounds: true }))).toEqual([
      "Sebastian",
      "Alfred",
      "Freya",
    ]);
  });
  it("keeps exactly the list a settings file holds", () => {
    const saved = [{ word: "Sebastian", enabled: false, threshold: 0.9 }];
    expect(wakeWordsFor({ wakeWords: saved })).toBe(saved);
  });
});
