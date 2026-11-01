import { describe, expect, it } from "vite-plus/test";

import { MARK_SMALL_PATH, TRAY_PNG, TRAY_SIZES } from "./trayArt.ts";
import { brandMarkSvg, markSvg, withTrayState } from "./trayMark.ts";

const px = (buf: Buffer, size: number, x: number, y: number) => [
  ...buf.subarray((y * size + x) * 4, (y * size + x) * 4 + 4),
];

describe("the tray mark's art", () => {
  it("carries every size in both colours as a PNG", () => {
    for (const colour of ["white", "black"]) {
      for (const size of TRAY_SIZES) {
        const bytes = Buffer.from(TRAY_PNG[`${colour}-${size}`]!, "base64");
        expect(bytes.subarray(1, 4).toString()).toBe("PNG");
        expect(bytes.readUInt32BE(16)).toBe(size);
      }
    }
  });
  it("draws the sidebar mark from the hinted cut in the page's ink", () => {
    expect(MARK_SMALL_PATH).toMatch(/^M[\d.]+[ ,][\d.]+L/);
    expect(brandMarkSvg()).toContain(MARK_SMALL_PATH);
    expect(brandMarkSvg()).toContain("currentColor");
  });
});

describe("the state on the tray mark", () => {
  const size = 32;
  const base = { color: "#22c55e", caps: [true, true, false], muted: false } as const;
  const clear = Buffer.alloc(size * size * 4);
  it("puts a dot of the state colour bottom right and leaves the top right alone", () => {
    const out = withTrayState(clear, size, base, true);
    expect(px(out, size, 28, 28)).toEqual([0x5e, 0xc5, 0x22, 255]);
    expect(px(out, size, 28, 3)[3]).toBe(0);
  });
  it("adds the update dot top right only when an update is ready", () => {
    const out = withTrayState(clear, size, { ...base, badge: true }, true);
    expect(px(out, size, 28, 3)).toEqual([0x5c, 0x50, 0xd8, 255]);
  });
  it("keeps the mark's own pixels away from the dot", () => {
    const mark = Buffer.alloc(size * size * 4, 255);
    const out = withTrayState(mark, size, base, false);
    expect(px(out, size, 2, 2)).toEqual([255, 255, 255, 255]);
    expect(px(out, size, 22, 28)[3]).toBe(0);
  });
  it("keeps the status tile for the Home page", () => {
    expect(markSvg({ ...base, muted: true })).toContain("<line");
  });
});
