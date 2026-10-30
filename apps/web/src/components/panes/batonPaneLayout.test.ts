import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ThreadRouteTarget } from "../../threadRoutes";
import {
  clampPaneFraction,
  closePane,
  openPane,
  paneGridArea,
  resolvePaneLayout,
  type PaneLayout,
} from "./batonPaneLayout";

const thread = (env: string, id: string): ThreadRouteTarget => ({
  kind: "server",
  threadRef: scopeThreadRef(EnvironmentId.make(env), ThreadId.make(id)),
});
const [t1, t2, t3, t4, t5] = ["1", "2", "3", "4", "5"].map((id) => thread("box", id)) as [
  ThreadRouteTarget,
  ThreadRouteTarget,
  ThreadRouteTarget,
  ThreadRouteTarget,
  ThreadRouteTarget,
];
const empty: PaneLayout = { slots: [], focusedSlotId: null };

describe("resolvePaneLayout", () => {
  it("gives the first route a pane", () => {
    expect(resolvePaneLayout(empty, t1)).toEqual({
      slots: [{ id: "a", target: t1 }],
      focusedSlotId: "a",
    });
  });

  it("moves focus to the pane already showing the route, keeping the object when nothing moved", () => {
    const two = openPane(resolvePaneLayout(empty, t1), t1, t2);
    expect(resolvePaneLayout(two, t2).focusedSlotId).toBe("b");
    expect(resolvePaneLayout(two, t1)).toBe(two);
  });

  it("puts a new route in the focused pane and leaves the others alone", () => {
    const two = resolvePaneLayout(openPane(resolvePaneLayout(empty, t1), t1, t2), t2);
    const moved = resolvePaneLayout(two, t3);
    expect(moved.slots.map((slot) => slot.target)).toEqual([t1, t3]);
    expect(moved.focusedSlotId).toBe("b");
  });

  it("tells the same thread id on two environments apart", () => {
    const other = thread("laptop", "1");
    const two = openPane(resolvePaneLayout(empty, t1), t1, other);
    expect(two.slots).toHaveLength(2);
  });
});

describe("openPane", () => {
  it("does not take focus and does not open a thread twice", () => {
    const two = openPane(empty, t1, t2);
    expect(two.focusedSlotId).toBe("a");
    expect(openPane(two, t1, t2)).toBe(two);
  });

  it("replaces the last unfocused pane when the grid is full", () => {
    const four = openPane(openPane(openPane(empty, t1, t2), t1, t3), t1, t4);
    const full = resolvePaneLayout(four, t4);
    const next = openPane(full, t4, t5);
    expect(next.slots.map((slot) => slot.target)).toEqual([t1, t2, t5, t4]);
    expect(next.focusedSlotId).toBe("d");
  });
});

describe("closePane", () => {
  const three = openPane(openPane(empty, t1, t2), t1, t3);

  it("closing an unfocused pane does not move the route", () => {
    const { layout, next } = closePane(three, "b");
    expect(next).toBeNull();
    expect(layout.slots.map((slot) => slot.id)).toEqual(["a", "c"]);
  });

  it("closing the focused pane hands the route to its neighbour", () => {
    const { layout, next } = closePane(three, "a");
    expect(next).toEqual(t2);
    expect(layout.focusedSlotId).toBe("b");
  });

  it("never closes the last pane", () => {
    const one = resolvePaneLayout(empty, t1);
    expect(closePane(one, "a").layout).toBe(one);
  });
});

describe("layout helpers", () => {
  it("clamps resizes so no pane collapses", () => {
    expect(clampPaneFraction(0.01)).toBe(0.25);
    expect(clampPaneFraction(0.99)).toBe(0.75);
    expect(clampPaneFraction(Number.NaN)).toBe(0.5);
  });

  it("lays three panes out as two over one", () => {
    expect(paneGridArea(1, 2)).toBe("1 / 2 / auto / auto");
    expect(paneGridArea(2, 3)).toBe("2 / 1 / 3 / 3");
    expect(paneGridArea(3, 4)).toBe("2 / 2 / auto / auto");
  });
});
