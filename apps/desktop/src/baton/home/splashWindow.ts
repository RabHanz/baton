// @effect-diagnostics globalTimers:off globalDate:off
/** Runs the splash: a small transparent window with the start animation that hands over to the app window. */
import * as Electron from "electron";

import { protectFromCapture } from "../captureProtection.ts";
import { SPLASH_FADE_MS, splashHtml, splashStep, splashWindowOptions, type SplashEvent, type SplashState } from "./splash.ts";
import type { Theme } from "./theme.ts";
import { WINDOW_STING_DARK, WINDOW_STING_LIGHT } from "./windowMotionArt.ts";

const TICK_MS = 50;

const fade = (apply: (opacity: number) => void, from: number, to: number, then?: () => void): void => {
  const started = Date.now();
  const timer = setInterval(() => {
    const t = Math.min(1, (Date.now() - started) / SPLASH_FADE_MS);
    apply(from + (to - from) * t);
    if (t >= 1) {
      clearInterval(timer);
      then?.();
    }
  }, 16);
  timer.unref();
};

/**
 * Shows the splash centred on `centre`. `windowReady(show)` says the app window can be shown: `show` runs when the
 * splash has played enough (or at the 2.5 s cap), and the app window should fade in with `fadeIn`.
 */
export const startSplash = (centre: { readonly x: number; readonly y: number }, theme: Theme) => {
  let state: SplashState = { phase: "idle" };
  let win: Electron.BrowserWindow | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let onShow: (() => void) | null = null;

  const close = (): void => {
    if (timer !== null) clearInterval(timer);
    timer = null;
    if (win !== null && !win.isDestroyed()) win.destroy();
    win = null;
  };
  const feed = (e: SplashEvent): void => {
    const step = splashStep(state, e);
    state = step.state;
    if (step.showWindow) {
      onShow?.();
      onShow = null;
      if (win !== null && !win.isDestroyed()) {
        const w = win;
        fade((o) => w.isDestroyed() || w.setOpacity(o), 1, 0);
      }
    }
    if (state.phase === "done") close();
  };

  try {
    win = new Electron.BrowserWindow(splashWindowOptions(centre));
    protectFromCapture(win);
    win.setIgnoreMouseEvents(true);
    win.once("ready-to-show", () => win?.showInactive());
    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml(theme === "dark" ? WINDOW_STING_DARK : WINDOW_STING_LIGHT))}`);
    feed({ type: "start", at: Date.now() });
    timer = setInterval(() => feed({ type: "tick", at: Date.now() }), TICK_MS);
    timer.unref();
  } catch {
    // A splash that cannot be made never stands in the way: the window just shows.
    close();
    state = { phase: "done" };
  }

  return {
    /** Calls `show` when the app window should appear: now if there is no splash, else when the timeline says. */
    whenToShow: (show: () => void): void => {
      if ((state.phase !== "playing" && state.phase !== "idle") || win === null) return show();
      onShow = show;
      feed({ type: "windowReady", at: Date.now() });
    },
    cancel: close,
    fade,
  };
};
