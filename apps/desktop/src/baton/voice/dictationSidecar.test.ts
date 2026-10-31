import { describe, expect, it } from "vite-plus/test";

import { resolveDictationBinary, restartDelayMs } from "./dictationSidecar.ts";

describe("restartDelayMs", () => {
  it("backs off to a minute and no further", () => {
    expect([1, 2, 3, 7, 50].map(restartDelayMs)).toEqual([1_000, 2_000, 4_000, 60_000, 60_000]);
  });
});

describe("resolveDictationBinary", () => {
  it("is null where the exe was not built", () => {
    expect(resolveDictationBinary({ resourcesPath: "/r", env: {}, exists: () => false })).toBe(
      null,
    );
  });
});
