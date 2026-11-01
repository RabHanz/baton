import { describe, expect, it } from "vite-plus/test";

import {
  isCompanionWindow,
  pickRevealable,
  keepRunningForTray,
  markCompanionWindow,
  shouldQuitOnAllClosed,
} from "./lastAppWindow.ts";

describe("what ends the app", () => {
  // In this order: the tray cannot be taken away again, in a test or in the app.
  it("quits on the last window while nothing is in the tray", () => {
    expect(shouldQuitOnAllClosed()).toBe(true);
  });

  it("keeps running with no windows at all once the tray is up", () => {
    keepRunningForTray();
    expect(shouldQuitOnAllClosed()).toBe(false);
  });
});

describe("companion windows", () => {
  it("are told apart from windows he opened", () => {
    const pill = {};
    markCompanionWindow(pill);
    expect(isCompanionWindow(pill)).toBe(true);
    expect(isCompanionWindow({})).toBe(false);
  });
});

describe("which window opening the sessions reveals", () => {
  it("is T3's, never Baton's own, so with only Baton's window up a new one is made", () => {
    const baton = {};
    const t3 = {};
    const aux = {};
    markCompanionWindow(baton);
    const isAux = (w: object) => w === aux;
    expect(pickRevealable([baton], isAux)).toBeUndefined();
    expect(pickRevealable([baton, aux], isAux)).toBeUndefined();
    expect(pickRevealable([baton, aux, t3], isAux)).toBe(t3);
  });
});
