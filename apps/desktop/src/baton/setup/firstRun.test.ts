import { describe, expect, it } from "vite-plus/test";

import { meterWidth, SETUP_STEPS, setupHoldControl, setupShouldShow } from "./firstRun.ts";

describe("first-run guide", () => {
  it("covers each thing a stranger must choose, in under a minute of clicks", () => {
    expect(SETUP_STEPS.map((s) => s.id)).toEqual(["assistant", "mic", "wake", "key", "try", "pill", "privacy"]);
  });
  it("shows once, only on a fresh install", () => {
    expect(setupShouldShow(true, undefined)).toBe(true);
    expect(setupShouldShow(true, true)).toBe(false);
    expect(setupShouldShow(false, undefined)).toBe(false);
  });
  it("keeps a key he set himself in the list instead of hiding it", () => {
    const c = setupHoldControl("Ctrl+F12");
    expect(c.kind === "choice" && c.options[0]).toEqual({ value: "", label: "Ctrl+F12 (your own)" });
    const d = setupHoldControl("F9");
    expect(d.kind === "choice" && d.value).toBe("F9");
  });
  it("moves the meter for quiet speech and stops at full", () => {
    expect(meterWidth(0)).toBe(0);
    expect(meterWidth(0.01)).toBeGreaterThan(10);
    expect(meterWidth(5)).toBe(100);
  });
});
