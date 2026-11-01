import { describe, expect, it } from "vite-plus/test";

import { addEntry, editEntry, forgetLearned, removeEntry } from "./dictionaryEdit.ts";

describe("the vocabulary", () => {
  it("adds a word, keeps one entry per phrase, and ignores an empty one", () => {
    const one = addEntry([], { phrase: " venture os ", replacement: "VentureOS" });
    expect(one).toEqual([{ phrase: "venture os", replacement: "VentureOS", source: "added" }]);
    const two = addEntry(one, { phrase: "Venture OS", replacement: "" });
    expect(two).toEqual([{ phrase: "Venture OS", replacement: null, source: "added" }]);
    expect(addEntry(two, { phrase: "  ", replacement: "x" })).toBe(two);
  });
  it("removes a word whatever its capitals", () => {
    expect(removeEntry([{ phrase: "Airdeck", replacement: null }], "airdeck")).toEqual([]);
  });
  it("edits a word and keeps what was learned about it", () => {
    const list = [
      {
        phrase: "airdeck",
        replacement: null,
        source: "learned" as const,
        count: 7,
        lastSeen: "2026-11-01T09:00:00Z",
      },
    ];
    expect(editEntry(list, "Airdeck", { phrase: "airdeck", replacement: "Airdeck" })).toEqual([
      {
        phrase: "airdeck",
        replacement: "Airdeck",
        source: "learned",
        count: 7,
        lastSeen: "2026-11-01T09:00:00Z",
      },
    ]);
    expect(editEntry(list, "missing", { phrase: "x", replacement: null })).toBe(list);
  });
  it("forgets what Baton learned and keeps what he added", () => {
    const list = [
      { phrase: "a", replacement: null, source: "learned" as const },
      { phrase: "b", replacement: "B", source: "added" as const },
      { phrase: "c", replacement: null },
    ];
    expect(forgetLearned(list).map((e) => e.phrase)).toEqual(["b", "c"]);
  });
});
