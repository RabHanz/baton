import { describe, expect, it } from "vite-plus/test";

import { defaultPosition, parseSpots, positionOf, spotFrom } from "./pillPlacement.ts";

const size = { width: 420, height: 52 };
const hd = { x: 0, y: 0, width: 1920, height: 1040 };
const second = { x: 1920, y: 0, width: 2560, height: 1400 };

describe("where the pill sits", () => {
  it("starts centred above the taskbar, or at the top", () => {
    const m = { top: 10, bottom: 44 };
    expect(defaultPosition(hd, size, "bottom", m)).toEqual({ x: 750, y: 944 });
    expect(defaultPosition(hd, size, "top", m)).toEqual({ x: 750, y: 10 });
  });
  it("keeps a dragged place as a fraction, so another resolution puts it in the same place", () => {
    const spot = spotFrom(hd, size, { x: 300, y: 500 });
    const there = positionOf({ x: 0, y: 0, width: 1280, height: 720 }, size, spot);
    expect(there.x).toBeGreaterThan(150);
    expect(there.x + size.width).toBeLessThanOrEqual(1280);
    expect(there.y + size.height).toBeLessThanOrEqual(720);
  });
  it("never leaves the work area, and follows a display that moved", () => {
    const off = spotFrom(hd, size, { x: 5000, y: -400 });
    expect(off).toEqual({ fx: 1, fy: 0 });
    expect(positionOf(second, size, off)).toEqual({ x: 1920 + 2560 - 420, y: 0 });
  });
  it("reads a saved file without trusting it", () => {
    expect(
      parseSpots({
        "1": { fx: 2, fy: -1 },
        "2": { fx: "a" },
        "3": null,
        "4": { fx: 0.5, fy: 0.5 },
      }),
    ).toEqual({
      "1": { fx: 1, fy: 0 },
      "4": { fx: 0.5, fy: 0.5 },
    });
    expect(parseSpots("nope")).toEqual({});
  });
});
