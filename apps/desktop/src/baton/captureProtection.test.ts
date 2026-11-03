import * as NodeOS from "node:os";

import { describe, expect, it } from "vite-plus/test";

import {
  hiddenForCapture,
  overlaysVisibleToCapture,
  protectFromCapture,
  setHideFromCapture,
} from "./captureProtection.ts";

const fakeWindow = (log: string[]) => ({
  setContentProtection: (on: boolean) => void log.push(`protect ${on}`),
  isDestroyed: () => false,
  isVisible: () => true,
  hide: () => void log.push("hide"),
  showInactive: () => void log.push("show"),
});

describe("overlay windows and screen capture", () => {
  it("are visible to a test run's recording only when it says where it records", () => {
    expect(overlaysVisibleToCapture({})).toBe(false);
    expect(overlaysVisibleToCapture({ BATON_TEST_DIR: "" })).toBe(false);
    expect(overlaysVisibleToCapture({ BATON_TEST_DIR: "C:\\out" })).toBe(true);
  });

  it("are not hidden from screenshots by default, follow the setting live, and are hidden only for Tessaya's own grab when it is off", async () => {
    const original = process.env["BATON_TEST_DIR"];
    delete process.env["BATON_TEST_DIR"];
    const log: string[] = [];
    protectFromCapture(fakeWindow(log));
    expect(log).toEqual(["protect false"]);
    await hiddenForCapture(async () => void log.push("grab"));
    // Windows and macOS keep the window up and only exclude it from the grab; elsewhere it is hidden.
    expect(log.slice(1)).toEqual(
      NodeOS.platform() === "win32" || NodeOS.platform() === "darwin"
        ? ["protect true", "grab", "protect false"]
        : ["hide", "grab", "show"],
    );
    log.length = 0;
    setHideFromCapture(true);
    await hiddenForCapture(async () => void log.push("grab"));
    expect(log).toEqual(["protect true", "grab"]);
    setHideFromCapture(false);
    if (original !== undefined) process.env["BATON_TEST_DIR"] = original;
  });
});
