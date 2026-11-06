// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { readSettings } from "./DesktopBatonVoice.ts";
import {
  addEntry,
  editEntry,
  forgetLearned,
  removeEntry,
  saveDictionary,
} from "./dictionaryEdit.ts";
import { dictionaryPath, readDictionary } from "./dictationRewriter.ts";

describe("the vocabulary", () => {
  it("adds a word, keeps one entry per phrase, and ignores an empty one", () => {
    const one = addEntry([], { phrase: " venture os ", replacement: "VantageOS" });
    expect(one).toEqual([{ phrase: "venture os", replacement: "VantageOS", source: "added" }]);
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
  it("forgets what Tessaya learned and keeps what he added", () => {
    const list = [
      { phrase: "a", replacement: null, source: "learned" as const },
      { phrase: "b", replacement: "B", source: "added" as const },
      { phrase: "c", replacement: null },
    ];
    expect(forgetLearned(list).map((e) => e.phrase)).toEqual(["b", "c"]);
  });
  it("never takes a damaged file for an empty list: it keeps it aside and keeps the words it had", () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "vocab-"));
    const had = [{ phrase: "airdeck", replacement: "Airdeck" }];
    saveDictionary(dir, had);
    const read = readDictionary(dir, []);
    expect(read.map((e) => e.replacement)).toEqual(["Airdeck"]);
    // One stray comma from a hand edit.
    NodeFS.writeFileSync(dictionaryPath(dir), '[{"phrase":"airdeck","replacement":"Airdeck"},]');
    expect(readDictionary(dir, read)).toEqual(read);
    expect(NodeFS.existsSync(`${dictionaryPath(dir)}.bad`)).toBe(true);

    const settings = NodePath.join(dir, "fabric-voice.json");
    NodeFS.writeFileSync(settings, '{"holdKey":"F9",');
    readSettings(settings);
    expect(NodeFS.readFileSync(`${settings}.bad`, "utf8")).toBe('{"holdKey":"F9",');
  });
});
