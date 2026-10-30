import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "../../lib/storage";
import type { ThreadRouteTarget } from "../../threadRoutes";
import {
  clampPaneFraction,
  closePane,
  openPane,
  paneTargetKey,
  resolvePaneLayout,
  type PaneLayout,
  type PaneSlotId,
} from "./batonPaneLayout";

interface BatonPanesState extends PaneLayout {
  readonly columnFraction: number;
  readonly rowFraction: number;
  readonly commitRoute: (route: ThreadRouteTarget) => void;
  readonly open: (route: ThreadRouteTarget, target: ThreadRouteTarget) => void;
  readonly close: (id: PaneSlotId) => void;
  readonly resize: (axis: "column" | "row", fraction: number) => void;
}

export const useBatonPanesStore = create<BatonPanesState>()(
  persist(
    (set, get) => ({
      slots: [],
      focusedSlotId: null,
      columnFraction: 0.5,
      rowFraction: 0.5,
      commitRoute: (route) => {
        const state = get();
        const next = resolvePaneLayout(state, route);
        if (next.slots !== state.slots || next.focusedSlotId !== state.focusedSlotId) {
          set({ slots: next.slots, focusedSlotId: next.focusedSlotId });
        }
      },
      open: (route, target) => {
        const next = openPane(get(), route, target);
        set({ slots: next.slots, focusedSlotId: next.focusedSlotId });
      },
      close: (id) => {
        const { layout } = closePane(get(), id);
        set({ slots: layout.slots, focusedSlotId: layout.focusedSlotId });
      },
      resize: (axis, fraction) =>
        set(
          axis === "column"
            ? { columnFraction: clampPaneFraction(fraction) }
            : { rowFraction: clampPaneFraction(fraction) },
        ),
    }),
    {
      name: "t3code:baton-panes:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: ({ slots, focusedSlotId, columnFraction, rowFraction }) => ({
        slots,
        focusedSlotId,
        columnFraction,
        rowFraction,
      }),
    },
  ),
);

/** Opens a thread beside the current one. Outside a thread route it has nothing to sit beside. */
export function openThreadInSplit(route: ThreadRouteTarget | null, target: ThreadRouteTarget) {
  if (route === null || paneTargetKey(route) === paneTargetKey(target)) return;
  useBatonPanesStore.getState().open(route, target);
}
