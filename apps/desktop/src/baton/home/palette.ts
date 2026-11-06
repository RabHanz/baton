// @effect-diagnostics nodeBuiltinImport:off
/**
 * The logo kit's three palettes (kit USAGE.md: Woad, Damson, Madder) as themes, each with a light and a dark half.
 * Woad is the default and is the window's own tokens in appStyle.ts; the others override the accent tokens.
 * The same palettes are published to the T3 window as environment themes (`<state>/themes/*.json`), so its own
 * Appearance settings can pick them.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

export type Palette = "woad" | "damson" | "madder";

interface Swatch {
  readonly label: string;
  readonly ink: string;
  readonly paper: string;
  readonly dye: string;
  readonly dyeOnDark: string;
}

export const PALETTES: Readonly<Record<Palette, Swatch>> = {
  woad: { label: "Woad", ink: "#0F1B1E", paper: "#EEEDE4", dye: "#14505A", dyeOnDark: "#5FB3B3" },
  damson: {
    label: "Damson",
    ink: "#151019",
    paper: "#F3EFEB",
    dye: "#4A205E",
    dyeOnDark: "#BC96CE",
  },
  // The kit's Madder on dark (#D8505C) reads at 4.3:1 on the dark panel; lifted to pass AA as text.
  madder: {
    label: "Madder",
    ink: "#1C1517",
    paper: "#F4EEE3",
    dye: "#8E1F2F",
    dyeOnDark: "#E0707A",
  },
};

/** The palette's accent where it must read on the given ground: the tray's resting dot, the taskbar. */
export const accentOf = (p: Palette, onDark: boolean): string =>
  onDark ? PALETTES[p].dyeOnDark : PALETTES[p].dye;

export const parsePalette = (v: unknown): Palette =>
  v === "damson" || v === "madder" ? v : "woad";

const mix = (a: string, b: string, p: number): string =>
  `#${[1, 3, 5]
    .map((i) =>
      Math.round(
        Number.parseInt(a.slice(i, i + 2), 16) * p +
          Number.parseInt(b.slice(i, i + 2), 16) * (1 - p),
      )
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

/** The dark theme's panel, from appStyle's DARK_TOKENS: the washes are mixed onto it. */
const DARK_PANEL = "#111214";

/** The accent tokens of one half, in the same proportions as Woad's hand-tuned ones. */
export const paletteTokens = (p: Palette, dark: boolean): Readonly<Record<string, string>> => {
  const s = PALETTES[p];
  const d = dark ? s.dyeOnDark : s.dye;
  return dark
    ? {
        accent: d,
        "accent-text": d,
        focus: d,
        "accent-ink": s.ink,
        "accent-deep": mix(d, DARK_PANEL, 0.12),
        "accent-wash": mix(d, DARK_PANEL, 0.16),
        "accent-edge": mix(d, DARK_PANEL, 0.4),
        "on-deep-soft": mix(d, "#ffffff", 0.7),
      }
    : {
        accent: d,
        "accent-text": d,
        focus: d,
        "accent-ink": "#ffffff",
        "accent-deep": mix(d, "#000000", 0.72),
        "accent-wash": mix(d, "#ffffff", 0.11),
        "accent-edge": mix(d, "#ffffff", 0.32),
        "on-deep-soft": mix(d, s.paper, 0.22),
      };
};

const block = (tokens: Readonly<Record<string, string>>) =>
  Object.entries(tokens)
    .map(([k, v]) => `--${k}:${v}`)
    .join(";");

/** Root classes from look.ts pick the palette; Woad needs no rule. */
export const PALETTE_CSS = (["damson", "madder"] as const)
  .map(
    (p) =>
      `html.palette-${p}:not([data-theme=dark]){${block(paletteTokens(p, false))}}html.palette-${p}[data-theme=dark]{${block(paletteTokens(p, true))}}`,
  )
  .join("\n");

/** One T3 environment theme file per palette: dark generated from the kit's ink and dye, light as overrides. */
export const paletteThemeFile = (p: Palette) => {
  const s = PALETTES[p];
  const light = paletteTokens(p, false);
  return {
    version: 1,
    name: `Tessaya ${s.label}`,
    appearance: "dark",
    canvas: s.ink,
    accent: s.dyeOnDark,
    variants: {
      light: {
        canvas: s.paper,
        chrome: s.paper,
        toolbar: s.paper,
        sidebar: s.paper,
        accent: s.dye,
        accentForeground: "#ffffff",
        focus: s.dye,
        accentSurface: light["accent-wash"]!,
        accentSurfaceForeground: s.dye,
      },
    },
  } as const;
};

/** Writes the three theme files the T3 server publishes; only when one is missing or differs, so the watcher stays quiet. */
export const publishPaletteThemes = (stateDir: string): void => {
  const dir = NodePath.join(stateDir, "themes");
  NodeFS.mkdirSync(dir, { recursive: true });
  for (const p of Object.keys(PALETTES) as Palette[]) {
    const file = NodePath.join(dir, `tessaya-${p}.json`);
    const text = `${JSON.stringify(paletteThemeFile(p), null, 2)}\n`;
    let old: string | null = null;
    try {
      old = NodeFS.readFileSync(file, "utf8");
    } catch {
      // Missing: written below.
    }
    if (old !== text) NodeFS.writeFileSync(file, text);
  }
};

/** The T3 window's own keys for its chosen theme and its light/dark mix (apps/web useTheme.ts, themePalette.ts). */
export const T3_THEME_KEY = "t3code:theme";
export const T3_THEME_HALVES_KEY = "t3code:theme-halves:v1";

/**
 * The T3 theme to select when he picks a palette here, or null to leave the T3 window alone. It follows while the
 * T3 window wears one of Tessaya's themes, or while it is still on T3's untouched default and Tessaya has never set
 * it. A theme he picked there himself, or a light/dark mix, is his: it is never replaced.
 */
export const linkedT3Theme = (
  palette: Palette,
  t3: { readonly theme: string | null; readonly halves: string | null },
  linkedBefore: boolean,
): string | null => {
  const ours = t3.theme !== null && t3.theme.startsWith("tessaya-");
  const untouched = (t3.theme === null || t3.theme === "system") && !linkedBefore;
  const mixed = t3.halves !== null && t3.halves !== "null";
  return !mixed && (ours || untouched) ? `tessaya-${palette}` : null;
};
