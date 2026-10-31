/**
 * "Last window closed, so quit" is about windows he opened. The ask box, a prompt, the pointer and
 * the pill come and go on their own, and when Baton started without its main window one of them
 * closing took the whole app down, sessions and all. Pure, so it can be tested without Electron.
 */
interface WindowLike {
  readonly once: (event: "closed", listener: () => void) => unknown;
}

const companions = new WeakSet<object>();
export const markCompanionWindow = (window: object): void => void companions.add(window);

let appWindowClosedLast: (() => boolean) | null = null;

export const trackAppWindows = (app: {
  readonly on: (
    event: "browser-window-created",
    listener: (event: unknown, window: WindowLike) => void,
  ) => unknown;
}): void => {
  const open = new Set<WindowLike>();
  let closedLast = false;
  app.on("browser-window-created", (_event, window) => {
    open.add(window);
    window.once("closed", () => {
      open.delete(window);
      if (companions.has(window)) return;
      closedLast = ![...open].some((other) => !companions.has(other));
    });
  });
  appWindowClosedLast = () => closedLast;
};

/** True when nothing tracks windows, so a build without Baton keeps upstream's behaviour. */
export const shouldQuitOnAllClosed = (): boolean => appWindowClosedLast?.() ?? true;
