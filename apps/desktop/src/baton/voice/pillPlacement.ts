/**
 * Where the pill sits (D141). Dragged, it keeps its place per display as a fraction of that display's
 * work area, so a change of resolution, scaling or taskbar moves it with the screen and never off it.
 * Pure, so the arithmetic is testable without a display.
 */
export interface Area {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 0 is the left or top edge of the free space, 1 the right or bottom. */
export interface Spot {
  readonly fx: number;
  readonly fy: number;
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

export const spotFrom = (
  area: Area,
  size: { readonly width: number; readonly height: number },
  at: { readonly x: number; readonly y: number },
): Spot => {
  const freeX = Math.max(1, area.width - size.width);
  const freeY = Math.max(1, area.height - size.height);
  return { fx: clamp01((at.x - area.x) / freeX), fy: clamp01((at.y - area.y) / freeY) };
};

export const positionOf = (
  area: Area,
  size: { readonly width: number; readonly height: number },
  spot: Spot,
): { readonly x: number; readonly y: number } => ({
  x: Math.round(area.x + clamp01(spot.fx) * Math.max(0, area.width - size.width)),
  y: Math.round(area.y + clamp01(spot.fy) * Math.max(0, area.height - size.height)),
});

/** Centred at the bottom, above the taskbar, or at the top: where it sits until he moves it. */
export const defaultPosition = (
  area: Area,
  size: { readonly width: number; readonly height: number },
  edge: "bottom" | "top",
  margins: { readonly top: number; readonly bottom: number },
): { readonly x: number; readonly y: number } => ({
  x: Math.round(area.x + (area.width - size.width) / 2),
  y: edge === "top" ? area.y + margins.top : area.y + area.height - size.height - margins.bottom,
});

/** A saved file is untrusted: only finite numbers in range become a spot. */
export const parseSpots = (raw: unknown): Readonly<Record<string, Spot>> => {
  if (typeof raw !== "object" || raw === null) return {};
  const out: Record<string, Spot> = {};
  for (const [key, value] of Object.entries(raw)) {
    const { fx, fy } = (value ?? {}) as { fx?: unknown; fy?: unknown };
    if (
      typeof fx === "number" &&
      typeof fy === "number" &&
      Number.isFinite(fx) &&
      Number.isFinite(fy)
    ) {
      out[key] = { fx: clamp01(fx), fy: clamp01(fy) };
    }
  }
  return out;
};
