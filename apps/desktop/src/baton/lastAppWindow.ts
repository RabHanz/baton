/**
 * Baton lives in the tray, so a window closing is never the end of it (D118). Only the tray's Quit
 * or a system shutdown ends the app. Without a tray there would be no way back, so a build or a
 * machine that has none keeps upstream's rule. Pure, so it can be tested without Electron.
 */
const companions = new WeakSet<object>();
export const markCompanionWindow = (window: object): void => void companions.add(window);
/** The ask box, a prompt, the pointer or the pill: never a window to bring up for him. */
export const isCompanionWindow = (window: object): boolean => companions.has(window);

let trayHolds = false;
export const keepRunningForTray = (): void => {
  trayHolds = true;
};

export const shouldQuitOnAllClosed = (): boolean => !trayHolds;
