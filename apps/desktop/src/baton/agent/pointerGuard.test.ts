import { describe, expect, it } from "vite-plus/test";

import { pointerMoved } from "./pointerGuard.ts";

describe("the mouse stays his", () => {
  it("allows the first action of a turn, and one where the pointer was left", () => {
    expect(pointerMoved(null, { x: 500, y: 400 })).toBe(false);
    expect(pointerMoved({ x: 500, y: 400 }, { x: 503, y: 398 })).toBe(false);
  });
  it("stops when he has moved it", () => {
    expect(pointerMoved({ x: 500, y: 400 }, { x: 700, y: 400 })).toBe(true);
    expect(pointerMoved({ x: 500, y: 400 }, { x: 500, y: 450 })).toBe(true);
  });
});
