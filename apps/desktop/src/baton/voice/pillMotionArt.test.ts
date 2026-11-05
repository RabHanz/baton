import { describe, expect, it } from "vite-plus/test";

import { LISTENING_WEBP, STING_WEBP } from "./pillMotionArt.ts";

/** An animated WebP's loop count: the two bytes after the ANIM chunk's background colour; 0 is forever. */
const loops = (base64: string): number => {
  const bytes = Buffer.from(base64, "base64");
  return bytes.readUInt16LE(bytes.indexOf("ANIM") + 8 + 4);
};

describe("the pill's motion art", () => {
  it("keeps the listening mark moving for as long as it listens, and plays the wake sting once", () => {
    expect(loops(LISTENING_WEBP)).toBe(0);
    expect(loops(STING_WEBP)).toBe(1);
  });
});
