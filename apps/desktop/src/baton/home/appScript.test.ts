import * as NodeVM from "node:vm";

import { describe, expect, it } from "vite-plus/test";

import { APP_SCRIPT } from "./appScript.ts";

describe("APP_SCRIPT", () => {
  // The page script lives in a template literal, so a stray escape such as /\+/ turns into /+/ and
  // the whole window fails to parse at runtime, where no type check can see it.
  it("parses as a script", () => {
    expect(() => new NodeVM.Script(APP_SCRIPT)).not.toThrow();
  });
  // The Home sentence and the Your voice row are built by these two functions from the enabled, shipped words only.
  it("names only the words it is given on Home", () => {
    const page = NodeVM.runInNewContext(
      `${/function sayWords[\s\S]*?\nfunction wakeLine[^\n]*/.exec(APP_SCRIPT)![0]}; ({ sayWords, wakeLine })`,
    ) as { sayWords: (w: string[]) => string; wakeLine: (w: string[]) => string };
    expect(page.sayWords(["Sebastian", "Alfred"])).toBe("Say Sebastian or Alfred to talk.");
    expect(page.wakeLine(["Sebastian", "Alfred"])).toBe("Sebastian, Alfred");
    expect(page.wakeLine([])).toBe("Off");
  });
});

describe("command palette", () => {
  const page = NodeVM.runInNewContext(
    `${/function paletteRank[\s\S]*?\n}\n/.exec(APP_SCRIPT)![0]}; ({ paletteRank })`,
  ) as { paletteRank: (items: unknown[], q: string) => Array<{ label: string }> };
  const items = [
    { kind: "Page", label: "Trust", hint: "Open the Trust page" },
    { kind: "Command", label: "Mute the microphone", hint: "" },
    { kind: "Setting", label: "Hold to dictate", hint: "Trust me" },
  ];
  it("matches every word, label first, and shows a few when the box is empty", () => {
    expect(page.paletteRank(items, "").length).toBe(3);
    expect(page.paletteRank(items, "trust").map((i) => i.label)).toEqual(["Trust", "Hold to dictate"]);
    expect(page.paletteRank(items, "mute mic").map((i) => i.label)).toEqual(["Mute the microphone"]);
    expect(page.paletteRank(items, "zzz")).toEqual([]);
  });
});
