import { describe, expect, it } from "vite-plus/test";

import { createOutputWatch, outputKindOf, speakerModeOf } from "./outputDevice.ts";

describe("headphones or speakers, from the playback device", () => {
  it.each([
    // [what the script printed: form factor;enumerator, what it means]
    ["3;HDAUDIO", "headphones"],
    ["5;USB", "headphones"],
    ["6;USB", "headphones"],
    ["1;HDAUDIO", "speakers"],
    ["2;HDAUDIO", "speakers"],
    ["9;HDAUDIO", "speakers"],
    // Bluetooth is worn, whatever form factor it reports.
    ["1;BTHENUM", "headphones"],
    ["10;BTHHFENUM", "headphones"],
    ["10;HDAUDIO", null],
    [";", null],
    ["", null],
    ["Exception calling Get", null],
  ] as const)("%s is %s", (out, kind) => {
    expect(outputKindOf(out)).toBe(kind);
  });

  it("follows the device on Automatic, and his choice otherwise", () => {
    expect(speakerModeOf("auto", "headphones")).toBe("headphones");
    expect(speakerModeOf("auto", null)).toBe("speakers");
    expect(speakerModeOf("speakers", "headphones")).toBe("speakers");
    expect(speakerModeOf("headphones", "speakers")).toBe("headphones");
  });

  it("reads at most once a while, only on Windows, and forgets a device that no longer says", async () => {
    let clock = 0;
    const outs = ["3;HDAUDIO", "10;HDAUDIO"];
    let runs = 0;
    const watch = createOutputWatch({
      platform: "win32",
      everyMs: 1_000,
      now: () => clock,
      run: async () => outs[runs++] ?? "",
    });
    await watch.refresh();
    expect(watch.kind()).toBe("headphones");
    await watch.refresh();
    expect(runs).toBe(1);
    clock = 1_000;
    await watch.refresh();
    expect(watch.kind()).toBe(null);
    const mac = createOutputWatch({ platform: "darwin", run: async () => "3;USB" });
    await mac.refresh();
    expect(mac.kind()).toBe(null);
  });
});
