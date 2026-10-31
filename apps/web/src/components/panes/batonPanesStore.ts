import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "../../lib/storage";
import type { ThreadRouteTarget } from "../../threadRoutes";
import {
  closePane,
  dockPaneTree,
  dockPaneTreeToEdge,
  fitPaneTree,
  openPane,
  paneTargetKey,
  resizePaneTree,
  resolvePaneLayout,
  type PaneDropZone,
  type PaneEdge,
  type PaneLayout,
  type PaneSlotId,
  type PaneTree,
} from "./batonPaneLayout";
import { announceClaim, batonWindowId, MAIN_WINDOW_ID, onThreadClaimed } from "./batonWindows";

interface BatonPanesState extends PaneLayout {
  readonly tree: PaneTree | null;
  /** Dragged or moved by hand, so opening a pane adapts the layout instead of resetting it. */
  readonly arranged: boolean;
  /** Threads another window claimed; this window keeps the pane and shows no ChatView for them. */
  readonly ceded: ReadonlyArray<string>;
  readonly commitRoute: (route: ThreadRouteTarget) => void;
  readonly open: (route: ThreadRouteTarget, target: ThreadRouteTarget) => void;
  readonly close: (id: PaneSlotId) => void;
  readonly resize: (path: ReadonlyArray<number>, index: number, at: number) => void;
  readonly dock: (moved: PaneSlotId, target: PaneSlotId, zone: PaneDropZone) => void;
  readonly dockToEdge: (moved: PaneSlotId, edge: PaneEdge) => void;
  readonly claim: (target: ThreadRouteTarget) => void;
}

const windowId = batonWindowId();

export const useBatonPanesStore = create<BatonPanesState>()(
  persist(
    (set, get) => {
      const currentTree = () => {
        const { tree, arranged, slots } = get();
        return fitPaneTree(
          tree,
          arranged,
          slots.map((slot) => slot.id),
        );
      };
      return {
        slots: [],
        focusedSlotId: null,
        tree: null,
        arranged: false,
        ceded: [],
        commitRoute: (route) => {
          const state = get();
          const next = resolvePaneLayout(state, route);
          const key = paneTargetKey(route);
          // Only a thread arriving here claims; a reload of a held pane must not take it back.
          if (!state.slots.some((slot) => paneTargetKey(slot.target) === key)) announceClaim(key);
          if (next.slots !== state.slots || next.focusedSlotId !== state.focusedSlotId) {
            set({ slots: next.slots, focusedSlotId: next.focusedSlotId });
          }
        },
        open: (route, target) => {
          const key = paneTargetKey(target);
          const next = openPane(get(), route, target);
          announceClaim(key);
          set((state) => ({
            slots: next.slots,
            focusedSlotId: next.focusedSlotId,
            ceded: state.ceded.filter((entry) => entry !== key),
          }));
        },
        close: (id) => {
          const { layout } = closePane(get(), id);
          set({
            slots: layout.slots,
            focusedSlotId: layout.focusedSlotId,
            arranged: layout.slots.length > 1 && get().arranged,
          });
        },
        resize: (path, index, at) => {
          const tree = currentTree();
          if (tree !== null) set({ tree: resizePaneTree(tree, path, index, at) });
        },
        dock: (moved, target, zone) => {
          const tree = currentTree();
          if (tree !== null) {
            set({ tree: dockPaneTree(tree, moved, target, zone), arranged: true });
          }
        },
        dockToEdge: (moved, edge) => {
          const tree = currentTree();
          if (tree !== null) set({ tree: dockPaneTreeToEdge(tree, moved, edge), arranged: true });
        },
        claim: (target) => {
          const key = paneTargetKey(target);
          announceClaim(key);
          set((state) => ({ ceded: state.ceded.filter((entry) => entry !== key) }));
        },
      };
    },
    {
      // The main window keeps the key it always had, so a layout from before detaching survives.
      name:
        windowId === MAIN_WINDOW_ID ? "t3code:baton-panes:v1" : `t3code:baton-panes:v1:${windowId}`,
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: ({ slots, focusedSlotId, tree, arranged, ceded }) => ({
        slots,
        focusedSlotId,
        tree,
        arranged,
        ceded,
      }),
    },
  ),
);

onThreadClaimed((key) => {
  const { slots, ceded } = useBatonPanesStore.getState();
  if (ceded.includes(key) || !slots.some((slot) => paneTargetKey(slot.target) === key)) return;
  useBatonPanesStore.setState({ ceded: [...ceded, key] });
});

/** Opens a thread beside the current one. Outside a thread route it has nothing to sit beside. */
export function openThreadInSplit(route: ThreadRouteTarget | null, target: ThreadRouteTarget) {
  if (route === null || paneTargetKey(route) === paneTargetKey(target)) return;
  useBatonPanesStore.getState().open(route, target);
}
