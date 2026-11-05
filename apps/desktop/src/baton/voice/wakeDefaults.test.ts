// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { readSettings } from "./DesktopBatonVoice.ts";
import { FRESH_WAKE_WORDS, wakeWordsFor } from "./wakeDefaults.ts";

const enabled = (words: ReadonlyArray<{ word: string; enabled: boolean }>) =>
  words.filter((w) => w.enabled).map((w) => w.word);

describe("wake words at start", () => {
  it("gives a fresh install Freya and Alfred until Tessaya has a model", () => {
    expect(enabled(wakeWordsFor(null))).toEqual(["Alfred", "Freya"]);
    expect(wakeWordsFor(null)).toBe(FRESH_WAKE_WORDS);
    // A saved list that has Tessaya on is switched off until its model ships.
    expect(
      enabled(
        wakeWordsFor({
          wakeWords: [
            { word: "Tessaya", enabled: true, threshold: 0.9 },
            { word: "Sebastian", enabled: true, threshold: 0.9 },
            { word: "Alfred", enabled: true, threshold: 0.9 },
          ],
        }),
      ),
    ).toEqual(["Sebastian", "Alfred"]);
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

describe("first launch after an update with an old saved list", () => {
  it("resolves Tessaya off in memory and in the file", () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "wake-"));
    const file = NodePath.join(dir, "fabric-voice.json");
    NodeFS.writeFileSync(
      file,
      JSON.stringify({
        wakeWords: [
          { word: "Tessaya", enabled: true, threshold: 0.95 },
          { word: "Sebastian", enabled: true, threshold: 0.97 },
          { word: "Alfred", enabled: true, threshold: 0.95 },
        ],
      }),
    );
    expect(enabled(readSettings(file).wakeWords)).toEqual(["Sebastian", "Alfred"]);
    const saved = JSON.parse(NodeFS.readFileSync(file, "utf8")) as {
      wakeWords: Array<{ word: string; enabled: boolean }>;
    };
    expect(saved.wakeWords.filter((w) => w.enabled).map((w) => w.word)).toEqual([
      "Sebastian",
      "Alfred",
    ]);
  });
});
