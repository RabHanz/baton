import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ThreadRouteTarget } from "../../threadRoutes";
import {
  closePane,
  dockPaneTree,
  dockPaneTreeToEdge,
  fitPaneTree,
  MIN_PANE_FRACTION,
  openPane,
  paneDividers,
  paneDropZone,
  paneLeaves,
  paneNeighbour,
  paneRects,
  presetPaneTree,
  resizePaneTree,
  resolvePaneLayout,
  type PaneLayout,
  type PaneSlotId,
  type PaneTree,
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

describe("the layout tree", () => {
  const three = presetPaneTree(["a", "b", "c"]) as PaneTree;
  const four = presetPaneTree(["a", "b", "c", "d"]) as PaneTree;
  const position = (tree: PaneTree, id: PaneSlotId) => {
    const box = paneRects(tree).find((rect) => rect.id === id)!.box;
    return [box.left, box.top, box.width, box.height].map((n) => Math.round(n * 100));
  };

  it("lays three panes out as three columns with two dividers", () => {
    expect(position(three, "a")).toEqual([0, 0, 33, 100]);
    expect(position(three, "b")).toEqual([33, 0, 33, 100]);
    expect(position(three, "c")).toEqual([67, 0, 33, 100]);
    expect(paneDividers(three).map((divider) => divider.dir)).toEqual(["row", "row"]);
  });

  it("lays four panes out as a two by two grid in slot order", () => {
    expect(position(four, "a")).toEqual([0, 0, 50, 50]);
    expect(position(four, "b")).toEqual([50, 0, 50, 50]);
    expect(position(four, "c")).toEqual([0, 50, 50, 50]);
    expect(position(four, "d")).toEqual([50, 50, 50, 50]);
    expect(paneDividers(four)).toHaveLength(3);
  });

  it("resizes only the two panes beside a divider and never collapses one", () => {
    const moved = resizePaneTree(three, [], 0, 0.5);
    expect(position(moved, "a")[2]).toBe(50);
    expect(position(moved, "b")[2]).toBe(17);
    expect(position(moved, "c")[2]).toBe(33);
    const clamped = resizePaneTree(three, [], 0, 0.99);
    expect(position(clamped, "b")[2]).toBe(MIN_PANE_FRACTION * 100);
    expect(resizePaneTree(three, [], 0, Number.NaN)).toBe(three);
  });

  it("resizes a nested divider inside its own split", () => {
    const moved = resizePaneTree(four, [0], 0, 0.3);
    expect(position(moved, "a")).toEqual([0, 0, 50, 30]);
    expect(position(moved, "b")).toEqual([50, 0, 50, 50]);
  });

  it("swaps on the centre and docks on an edge", () => {
    expect(position(dockPaneTree(three, "a", "c", "center"), "a")).toEqual([67, 0, 33, 100]);
    const docked = dockPaneTree(three, "c", "a", "bottom");
    expect(position(docked, "a")).toEqual([0, 0, 50, 50]);
    expect(position(docked, "c")).toEqual([0, 50, 50, 50]);
    expect(position(docked, "b")).toEqual([50, 0, 50, 100]);
    expect(dockPaneTree(three, "a", "a", "left")).toBe(three);
  });

  it("gives a whole side to a pane and keeps the rest", () => {
    const docked = dockPaneTreeToEdge(three, "b", "top");
    expect(position(docked, "b")).toEqual([0, 0, 100, 50]);
    expect(position(docked, "a")).toEqual([0, 50, 50, 50]);
  });

  it("presets until arranged, then adapts", () => {
    const docked = dockPaneTree(three, "c", "a", "bottom");
    expect(fitPaneTree(three, false, ["a", "b", "c", "d"])).toEqual(four);
    const grown = fitPaneTree(docked, true, ["a", "b", "c", "d"]) as PaneTree;
    expect(position(grown, "a")).toEqual([0, 0, 50, 50]);
    expect(paneLeaves(grown).toSorted()).toEqual(["a", "b", "c", "d"]);
    expect(paneLeaves(fitPaneTree(docked, true, ["b", "c"]))).toEqual(["c", "b"]);
    expect(fitPaneTree(three, false, ["a", "b", "c"])).toBe(three);
  });

  it("finds the neighbour on a side and none past the edge", () => {
    const rects = paneRects(four);
    expect(paneNeighbour(rects, "a", "right")).toBe("b");
    expect(paneNeighbour(rects, "a", "bottom")).toBe("c");
    expect(paneNeighbour(rects, "a", "left")).toBeNull();
  });

  it("reads a drop near an edge as a dock and the middle as a swap", () => {
    expect(paneDropZone(0.1, 0.5)).toBe("left");
    expect(paneDropZone(0.5, 0.9)).toBe("bottom");
    expect(paneDropZone(0.5, 0.5)).toBe("center");
  });
});
