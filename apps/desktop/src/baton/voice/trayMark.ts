/**
 * Baton's mark: a tile whose colour is the state, with three bars for the capabilities on (lit) or off
 * (dim); a slash is muted. One geometry draws the tray bitmap and the SVG the app icons come from.
 */
export interface MarkOptions {
  readonly color: string;
  /** Listening, screen capture, acting without asking. */
  readonly caps: readonly [boolean, boolean, boolean];
  readonly muted: boolean;
  /** An update is ready: a small dot in the corner, drawn on the tray bitmap. */
  readonly badge?: boolean;
}

const BOX = 32;
const RADIUS = 8;
const BAR_W = 4;
const BARS: ReadonlyArray<{ readonly x: number; readonly h: number }> = [
  { x: 9.5, h: 11 },
  { x: 16, h: 19 },
  { x: 22.5, h: 14 },
];
/** The update dot: white, top right, with a ring of bare tile around it. */
const BADGE = { x: 25.5, y: 6.5, r: 3.6, gap: 5.8 };
const OFF_ALPHA = 0.38;
const SLASH = { x1: 6.5, y1: 25.5, x2: 25.5, y2: 6.5, w: 3 };

const rgb = (color: string) =>
  [1, 3, 5].map((i) => Number.parseInt(color.slice(i, i + 2), 16)) as [number, number, number];

export const markSvg = (o: MarkOptions): string => {
  const bars = BARS.map((b, i) => {
    const lit = o.caps[i]! && !o.muted;
    return `<rect x="${b.x - BAR_W / 2}" y="${16 - b.h / 2}" width="${BAR_W}" height="${b.h}" rx="${BAR_W / 2}" fill="#fff" fill-opacity="${lit ? 1 : OFF_ALPHA}"/>`;
  }).join("");
  const slash = o.muted
    ? `<line x1="${SLASH.x1}" y1="${SLASH.y1}" x2="${SLASH.x2}" y2="${SLASH.y2}" stroke="#fff" stroke-width="${SLASH.w}" stroke-linecap="round"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BOX} ${BOX}"><rect width="${BOX}" height="${BOX}" rx="${RADIUS}" fill="${o.color}"/>${bars}${slash}</svg>`;
};

/** Distance from a point to a segment, for the rounded bars and the slash. */
const segDist = (
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
};

const insideTile = (x: number, y: number): boolean => {
  const cx = Math.min(Math.max(x, RADIUS), BOX - RADIUS);
  const cy = Math.min(Math.max(y, RADIUS), BOX - RADIUS);
  return (x - cx) ** 2 + (y - cy) ** 2 <= RADIUS ** 2;
};

/** BGRA, `size` square, 3x3 samples a pixel for soft edges. */
export const markBitmap = (o: MarkOptions, size: number): Buffer => {
  const [r, g, b] = rgb(o.color);
  const out = Buffer.alloc(size * size * 4);
  const SS = 3;
  const scale = BOX / size;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let a = 0;
      let rr = 0;
      let gg = 0;
      let bb = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) * scale;
          const y = (py + (sy + 0.5) / SS) * scale;
          if (!insideTile(x, y)) continue;
          let white = 0;
          BARS.forEach((bar, i) => {
            const half = (bar.h - BAR_W) / 2;
            if (segDist(x, y, bar.x, 16 - half, bar.x, 16 + half) <= BAR_W / 2) {
              white = Math.max(white, o.caps[i]! && !o.muted ? 1 : OFF_ALPHA);
            }
          });
          if (o.muted && segDist(x, y, SLASH.x1, SLASH.y1, SLASH.x2, SLASH.y2) <= SLASH.w / 2) {
            white = 1;
          }
          a += 1;
          const d2 = (x - BADGE.x) ** 2 + (y - BADGE.y) ** 2;
          if (o.badge === true && d2 <= BADGE.r ** 2) {
            [rr, gg, bb] = [rr + 255, gg + 255, bb + 255];
            continue;
          }
          // A ring of bare tile around the dot, so it reads on any bar or state colour.
          if (o.badge === true && d2 <= BADGE.gap ** 2) white = 0;
          rr += r + (255 - r) * white;
          gg += g + (255 - g) * white;
          bb += b + (255 - b) * white;
        }
      }
      if (a === 0) continue;
      out.set([bb / a, gg / a, rr / a, (a / (SS * SS)) * 255], (py * size + px) * 4);
    }
  }
  return out;
};
