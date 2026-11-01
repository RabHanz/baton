import { describe, expect, it } from "vite-plus/test";

import { DARK_TOKENS } from "./appStyle.ts";

const tokens = Object.fromEntries(
  [...DARK_TOKENS.matchAll(/--([a-z-]+):(#[0-9a-f]{6})/g)].map((m) => [m[1]!, m[2]!]),
);
const channel = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => channel(Number.parseInt(hex.slice(i, i + 2), 16)));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

describe("the dark theme's contrast", () => {
  it("keeps every text pair at WCAG AA (4.5:1) and the focus ring and switch visible (3:1)", () => {
    const text: ReadonlyArray<readonly [string, string]> = [
      ["ink", "panel"],
      ["ink", "sunk"],
      ["ink", "ground"],
      ["soft", "panel"],
      ["soft", "sunk"],
      ["soft", "side"],
      ["faint", "panel"],
      ["faint", "sunk"],
      ["accent-text", "accent-wash"],
      ["warn", "warn-wash"],
      ["bad", "bad-wash"],
      ["warn", "panel"],
      ["bad", "panel"],
      ["on-deep", "accent-deep"],
      ["on-deep-soft", "accent-deep"],
      ["btn-deep-fg", "btn-deep-bg"],
      ["on-ink", "ink"],
      ["soft", "quiet"],
      ["ink", "quiet"],
    ];
    for (const [fg, bg] of text) {
      expect(ratio(tokens[fg]!, tokens[bg]!), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(ratio(tokens["focus"]!, tokens["panel"]!)).toBeGreaterThanOrEqual(3);
    expect(ratio(tokens["accent"]!, tokens["panel"]!)).toBeGreaterThanOrEqual(3);
  });
});
