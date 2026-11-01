import { describe, expect, it } from "vite-plus/test";

import { markBitmap, markSvg } from "./trayMark.ts";

const px = (buf: Buffer, size: number, x: number, y: number) => [
  ...buf.subarray((y * size + x) * 4, (y * size + x) * 4 + 4),
];

describe("mark", () => {
  const base = { color: "#22c55e", caps: [true, true, false], muted: false } as const;
  it("keeps the corners clear and the tile in the state colour", () => {
    const buf = markBitmap(base, 32);
    expect(px(buf, 32, 0, 0)[3]).toBe(0);
    expect(px(buf, 32, 3, 16)).toEqual([0x5e, 0xc5, 0x22, 255]);
  });
  it("shows a capability that is on brighter than one that is off", () => {
    const buf = markBitmap(base, 32);
    const lit = px(buf, 32, 16, 16)[0]!;
    const off = px(buf, 32, 22, 16)[0]!;
    expect(lit).toBe(255);
    expect(off).toBeLessThan(lit);
  });
  it("draws a slash only when muted, and dims every bar", () => {
    const muted = markBitmap({ ...base, muted: true }, 32);
    expect(px(muted, 32, 9, 16)[0]).toBeLessThan(255);
    expect(markSvg({ ...base, muted: true })).toContain("<line");
    expect(markSvg(base)).not.toContain("<line");
  });
});
