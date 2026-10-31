import { describe, expect, it } from "vite-plus/test";

import { markCompanionWindow, shouldQuitOnAllClosed, trackAppWindows } from "./lastAppWindow.ts";

const rig = () => {
  let created: ((event: unknown, window: never) => void) | null = null;
  trackAppWindows({ on: (_e, listener) => (created = listener as never) });
  const open = (companion = false) => {
    let closed: () => void = () => {};
    const window = { once: (_e: string, listener: () => void) => (closed = listener) };
    created!(null, window as never);
    if (companion) markCompanionWindow(window);
    return () => closed();
  };
  return open;
};

describe("quitting when the last window closes", () => {
  it("stays up when only a companion window was ever open", () => {
    const open = rig();
    open(true)();
    expect(shouldQuitOnAllClosed()).toBe(false);
  });

  it("quits when he closes the main window, even with the pill still up", () => {
    const open = rig();
    const closeMain = open();
    const closePill = open(true);
    closeMain();
    closePill();
    expect(shouldQuitOnAllClosed()).toBe(true);
  });

  it("does not quit while a detached window remains", () => {
    const open = rig();
    const closeMain = open();
    open();
    closeMain();
    expect(shouldQuitOnAllClosed()).toBe(false);
  });
});
