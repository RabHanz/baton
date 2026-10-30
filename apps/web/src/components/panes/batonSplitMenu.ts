import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ContextMenuItem, LocalApi, ScopedThreadRef } from "@t3tools/contracts";

import type { ThreadRouteTarget } from "../../threadRoutes";
import { paneTargetKey } from "./batonPaneLayout";

export const BATON_SPLIT_MENU_ITEM = "baton-open-in-split";

/** The thread menu with one item on top, absent for the thread already on screen. */
export function showWithSplitItem(
  api: Pick<LocalApi, "contextMenu">,
  route: ThreadRouteTarget | null,
  threadRef: ScopedThreadRef,
) {
  return <T extends string>(
    items: readonly ContextMenuItem<T>[],
    position?: { x: number; y: number },
  ) => {
    const onScreen = route === null || paneTargetKey(route) === scopedThreadKey(threadRef);
    return api.contextMenu.show<T | typeof BATON_SPLIT_MENU_ITEM>(
      onScreen ? items : [{ id: BATON_SPLIT_MENU_ITEM, label: "Open in split" }, ...items],
      position,
    );
  };
}
