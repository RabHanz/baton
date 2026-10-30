import { scopedThreadKey } from "@t3tools/client-runtime/environment";

import type { ThreadRouteTarget } from "../../threadRoutes";

/** Slot ids are fixed so a pane's React key survives every open, close and reassignment. */
export const PANE_SLOT_IDS = ["a", "b", "c", "d"] as const;
export type PaneSlotId = (typeof PANE_SLOT_IDS)[number];

export interface PaneSlot {
  readonly id: PaneSlotId;
  readonly target: ThreadRouteTarget;
}

export interface PaneLayout {
  readonly slots: ReadonlyArray<PaneSlot>;
  readonly focusedSlotId: PaneSlotId | null;
}

export const MIN_PANE_FRACTION = 0.25;

export function paneTargetKey(target: ThreadRouteTarget): string {
  return target.kind === "server" ? scopedThreadKey(target.threadRef) : target.draftId;
}

const freeSlotId = (slots: ReadonlyArray<PaneSlot>): PaneSlotId | null =>
  PANE_SLOT_IDS.find((id) => !slots.some((slot) => slot.id === id)) ?? null;

/** The route is the focus: its pane if open, otherwise the focused pane takes the route's thread. */
export function resolvePaneLayout(layout: PaneLayout, route: ThreadRouteTarget): PaneLayout {
  const routeKey = paneTargetKey(route);
  const open = layout.slots.find((slot) => paneTargetKey(slot.target) === routeKey);
  if (open) {
    return open.id === layout.focusedSlotId ? layout : { ...layout, focusedSlotId: open.id };
  }
  const focused =
    layout.slots.find((slot) => slot.id === layout.focusedSlotId) ?? layout.slots[0] ?? null;
  if (focused === null) return { slots: [{ id: "a", target: route }], focusedSlotId: "a" };
  return {
    slots: layout.slots.map((slot) =>
      slot.id === focused.id ? { id: slot.id, target: route } : slot,
    ),
    focusedSlotId: focused.id,
  };
}

/** Adds a pane without moving focus. A full grid gives up its last unfocused pane. */
export function openPane(
  layout: PaneLayout,
  route: ThreadRouteTarget,
  target: ThreadRouteTarget,
): PaneLayout {
  const resolved = resolvePaneLayout(layout, route);
  const key = paneTargetKey(target);
  if (resolved.slots.some((slot) => paneTargetKey(slot.target) === key)) return resolved;
  const id = freeSlotId(resolved.slots);
  if (id !== null) return { ...resolved, slots: [...resolved.slots, { id, target }] };
  const evicted = resolved.slots.findLast((slot) => slot.id !== resolved.focusedSlotId);
  return {
    ...resolved,
    slots: resolved.slots.map((slot) => (slot.id === evicted?.id ? { id: slot.id, target } : slot)),
  };
}

/** Removes a pane only; its thread and draft are untouched. `next` is where focus must go. */
export function closePane(
  layout: PaneLayout,
  id: PaneSlotId,
): { readonly layout: PaneLayout; readonly next: ThreadRouteTarget | null } {
  const index = layout.slots.findIndex((slot) => slot.id === id);
  if (index === -1 || layout.slots.length <= 1) return { layout, next: null };
  const slots = layout.slots.filter((slot) => slot.id !== id);
  if (layout.focusedSlotId !== id) return { layout: { ...layout, slots }, next: null };
  const neighbour = slots[Math.min(index, slots.length - 1)]!;
  return {
    layout: { slots, focusedSlotId: neighbour.id },
    next: neighbour.target,
  };
}

export function clampPaneFraction(fraction: number): number {
  if (!Number.isFinite(fraction)) return 0.5;
  return Math.min(1 - MIN_PANE_FRACTION, Math.max(MIN_PANE_FRACTION, fraction));
}

/** Grid placement: 2 side by side, 3 is two over one, 4 is two by two. */
export function paneGridArea(index: number, count: number): string {
  if (count === 3 && index === 2) return "2 / 1 / 3 / 3";
  return `${Math.floor(index / 2) + 1} / ${(index % 2) + 1} / auto / auto`;
}
