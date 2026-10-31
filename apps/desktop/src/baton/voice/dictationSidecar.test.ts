import { describe, expect, it } from "vite-plus/test";

import { resolveDictationBinary, restartDelayMs } from "./dictationSidecar.ts";

describe("restartDelayMs", () => {
  it("backs off to a minute and no further", () => {
    expect([1, 2, 3, 7, 50].map(restartDelayMs)).toEqual([1_000, 2_000, 4_000, 60_000, 60_000]);
  });
});

describe("resolveDictationBinary", () => {
  it("is null where it was not built", () => {
    expect(
      resolveDictationBinary({
        resourcesPath: "/r",
        platform: "linux",
        env: {},
        exists: () => false,
      }),
    ).toBe(null);
  });

  it("names the binary for the platform", () => {
    const found = (platform: string) =>
      resolveDictationBinary({ resourcesPath: "/r", platform, env: {}, exists: () => true });
    expect(found("win32")?.endsWith("baton-dictation.exe")).toBe(true);
    expect(found("darwin")?.endsWith("baton-dictation")).toBe(true);
  });
});
