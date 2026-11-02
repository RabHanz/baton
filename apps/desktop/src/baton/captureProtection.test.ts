import { describe, expect, it } from "vite-plus/test";

import { overlaysVisibleToCapture, protectFromCapture } from "./captureProtection.ts";

describe("overlay windows and screen capture", () => {
  it("are protected in a normal run and visible only when a test run says where it records", () => {
    expect(overlaysVisibleToCapture({})).toBe(false);
    expect(overlaysVisibleToCapture({ BATON_TEST_DIR: "" })).toBe(false);
    expect(overlaysVisibleToCapture({ BATON_TEST_DIR: "C:\\out" })).toBe(true);
  });
  it("sets the window's protection from that", () => {
    const seen: boolean[] = [];
    const original = process.env["BATON_TEST_DIR"];
    delete process.env["BATON_TEST_DIR"];
    protectFromCapture({ setContentProtection: (on) => seen.push(on) });
    process.env["BATON_TEST_DIR"] = "x";
    protectFromCapture({ setContentProtection: (on) => seen.push(on) });
    if (original === undefined) delete process.env["BATON_TEST_DIR"];
    else process.env["BATON_TEST_DIR"] = original;
    expect(seen).toEqual([true, false]);
  });
});
