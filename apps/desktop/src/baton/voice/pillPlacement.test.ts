import { describe, expect, it } from "vite-plus/test";

import {
  PLACES,
  cursorOverCapsule,
  defaultPosition,
  parseSpots,
  placePosition,
  positionOf,
  snapPosition,
  spotFrom,
} from "./pillPlacement.ts";

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

describe("snapping a drag", () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 };
  const size = { width: 420, height: 52 };
  const margins = { top: 10, bottom: 44 };
  const free = { bypass: false, margins };

  it("pulls onto a named place when near it, and names it", () => {
    const centre = placePosition(area, size, "centre", margins);
    expect(snapPosition(area, size, { x: centre.x + 25, y: centre.y - 18 }, free)).toEqual({
      ...centre,
      place: "centre",
    });
    const bottom = placePosition(area, size, "bottom", margins);
    expect(snapPosition(area, size, { x: bottom.x - 10, y: bottom.y + 9 }, free)).toMatchObject({
      y: bottom.y,
      place: "bottom",
    });
    expect(snapPosition(area, size, { x: 3, y: 4 }, free)).toMatchObject({ place: "top-left" });
  });

  it("steps onto a grid elsewhere, stays inside the work area, and leaves free placement to Alt or Shift", () => {
    const grid = snapPosition(area, size, { x: 400, y: 300 }, free);
    expect(grid.place).toBeNull();
    expect((grid.x / ((area.width - size.width) / 24)) % 1).toBeCloseTo(0, 5);
    expect(snapPosition(area, size, { x: 5000, y: -200 }, free)).toMatchObject({
      x: 1500,
      y: 10,
      place: "top-right",
    });
    expect(snapPosition(area, size, { x: 401, y: 303 }, { ...free, bypass: true })).toEqual({
      x: 401,
      y: 303,
      place: null,
    });
    expect(PLACES.map((p) => p.id)).toContain("centre");
  });
});

describe("dragging is free on both axes", () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 };
  const size = { width: 420, height: 52 };
  const margins = { top: 10, bottom: 44 };
  const free = { bypass: false, margins };

  it("from bottom centre, a cursor 200 px up lands 200 px up, and one 400 px up goes on past the middle", () => {
    const bottom = placePosition(area, size, "bottom", margins);
    const up200 = snapPosition(area, size, { x: bottom.x, y: bottom.y - 200 }, free);
    expect(up200.place).toBeNull();
    expect(up200.y).toBeLessThan(bottom.y - 150);
    expect(up200.y).toBeGreaterThan(bottom.y - 250);
    const up500 = snapPosition(area, size, { x: bottom.x + 90, y: bottom.y - 500 }, free);
    expect(up500.y).toBeLessThan(bottom.y - 450);
    // Sideways moves too, with the row kept.
    const across = snapPosition(area, size, { x: bottom.x + 300, y: bottom.y }, free);
    expect(across.x).toBeGreaterThan(bottom.x + 250);
    expect(Math.abs(across.y - bottom.y)).toBeLessThan(25);
  });
});

describe("grabbing the pill", () => {
  // The laptop's 735x91 window at 1554,82 with the capsule drawn at x 302..434, y 26..67.
  const window = { x: 1554, y: 82, width: 735, height: 91 };
  const capsule = { x: 302, y: 26, width: 132, height: 41 };
  it("takes the mouse over the whole capsule and lets it through elsewhere", () => {
    expect(cursorOverCapsule({ x: 1922, y: 128 }, window, capsule)).toBe(true);
    expect(cursorOverCapsule({ x: 1860, y: 110 }, window, capsule)).toBe(true);
    expect(cursorOverCapsule({ x: 1554 + 100, y: 128 }, window, capsule)).toBe(false);
    expect(cursorOverCapsule({ x: 1922, y: 82 + 5 }, window, capsule)).toBe(false);
  });
});
