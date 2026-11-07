import { describe, expect, it } from "vite-plus/test";

import {
  createOutputWatch,
  outputDeviceFrom,
  outputKindOf,
  readScript,
  speakerModeOf,
} from "./outputDevice.ts";

describe("headphones or speakers, from the playback device", () => {
  it.each([
    // [what the reader printed (a form factor, maybe more after it), what it means]
    ["3", "headphones"],
    ["5", "headphones"],
    ["6", "headphones"],
    ["1", "speakers"],
    ["2", "speakers"],
    ["9", "speakers"],
    // Only the form factor decides: a Bluetooth speaker or soundbar is a speaker, never headphones.
    ["1;BTHENUM", "speakers"],
    ["10;BTHHFENUM", null],
    ["10", null],
    ["", null],
    ["Exception calling Get", null],
  ] as const)("%j is %s", (out, kind) => {
    expect(outputKindOf(out)).toBe(kind);
  });

  it("follows the device on Automatic, and his choice otherwise", () => {
    expect(speakerModeOf("auto", "headphones")).toBe("headphones");
    expect(speakerModeOf("auto", null)).toBe("speakers");
    expect(speakerModeOf("speakers", "headphones")).toBe("speakers");
    expect(speakerModeOf("headphones", "speakers")).toBe("headphones");
  });

  it.each([
    // [saved settings, the choice they mean]
    [{ headphones: true }, "headphones"],
    [{ headphones: true, outputDevice: "auto" }, "auto"],
    [{}, "auto"],
    [{ outputDevice: "bogus" }, "auto"],
    [{ outputDevice: "speakers" }, "speakers"],
  ] as const)("reads %j as %s", (saved, choice) => {
    expect(outputDeviceFrom(saved)).toBe(choice);
  });

  it("compiles the reader once, into its own folder, and only loads it after that", () => {
    const script = readScript("C:\\Users\\user\\state's\\voice");
    expect(script).toMatch(/-OutputAssembly \$dll/);
    expect(script).toMatch(/if \(-not \(Test-Path -LiteralPath \$dll\)\)/);
    expect(script).toContain("C:\\Users\\user\\state''s\\voice\\tessaya-output-");
  });

  it("reads at most once a while, except after headphones, only on Windows, and forgets on a failed read", async () => {
    let clock = 0;
    const outs: Array<string | Error> = ["1", "3", "3", new Error("powershell")];
    let runs = 0;
    const watch = createOutputWatch({
      platform: "win32",
      dir: "x",
      everyMs: 1_000,
      now: () => clock,
      run: async () => {
        const out = outs[runs++];
        if (out instanceof Error) throw out;
        return out ?? "";
      },
    });
    await watch.refresh();
    expect(watch.kind()).toBe("speakers");
    await watch.refresh();
    expect(runs).toBe(1);
    clock = 1_000;
    await watch.refresh();
    expect(watch.kind()).toBe("headphones");
    // Headphones on: every look reads again, so taking them off is seen at once.
    await watch.refresh();
    expect(runs).toBe(3);
    await watch.refresh();
    expect(watch.kind()).toBe(null);
    const mac = createOutputWatch({ platform: "darwin", dir: "x", run: async () => "3" });
    await mac.refresh();
    expect(mac.kind()).toBe(null);
  });
});
