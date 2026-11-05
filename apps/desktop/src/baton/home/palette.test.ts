// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { EnvironmentThemeFile, environmentThemeFileHasColors } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { APP_CSS } from "./appStyle.ts";
import {
  PALETTES,
  paletteThemeFile,
  parsePalette,
  publishPaletteThemes,
  type Palette,
} from "./palette.ts";

describe("the palettes", () => {
  it("parses a saved choice, and anything else is Woad", () => {
    expect(["damson", "madder", "woad", "purple", undefined].map(parsePalette)).toEqual([
      "damson",
      "madder",
      "woad",
      "woad",
      "woad",
    ]);
  });

  it("gives the window a light and a dark rule for each palette but Woad", () => {
    for (const p of ["damson", "madder"])
      for (const half of [
        `html.palette-${p}:not([data-theme=dark]){`,
        `html.palette-${p}[data-theme=dark]{`,
      ])
        expect(APP_CSS).toContain(half);
    expect(APP_CSS).not.toContain("palette-woad");
  });

  it("publishes theme files the T3 server accepts, and rewrites none that did not change", () => {
    const decode = Schema.decodeUnknownSync(EnvironmentThemeFile);
    for (const p of Object.keys(PALETTES) as Palette[])
      expect(environmentThemeFileHasColors(decode(paletteThemeFile(p)))).toBe(true);
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "palettes-"));
    publishPaletteThemes(dir);
    const file = NodePath.join(dir, "themes", "tessaya-damson.json");
    expect(NodeFS.readdirSync(NodePath.join(dir, "themes")).toSorted()).toEqual([
      "tessaya-damson.json",
      "tessaya-madder.json",
      "tessaya-woad.json",
    ]);
    NodeFS.utimesSync(file, 0, 0);
    publishPaletteThemes(dir);
    expect(NodeFS.statSync(file).mtimeMs).toBe(0);
  });
});
