import { describe, expect, it } from "vite-plus/test";

import {
  SPLASH_CAP_MS,
  SPLASH_FADE_MS,
  SPLASH_MIN_MS,
  shouldSplash,
  splashHtml,
  splashStep,
  splashWindowOptions,
  type SplashEvent,
  type SplashState,
} from "./splash.ts";

const run = (events: ReadonlyArray<SplashEvent>) => {
  let state: SplashState = { phase: "idle" };
  const shown: number[] = [];
  for (const e of events) {
    const step = splashStep(state, e);
    state = step.state;
    if (step.showWindow) shown.push(e.at);
  }
  return { state, shown };
};

describe("the splash timeline", () => {
  it("plays at least 1.4 s, then hands over when the window is ready", () => {
    const early = run([{ type: "start", at: 0 }, { type: "windowReady", at: 300 }, { type: "tick", at: 1_000 }]);
    expect(early.shown).toEqual([]);
    const later = run([{ type: "start", at: 0 }, { type: "windowReady", at: 300 }, { type: "tick", at: 1_000 }, { type: "tick", at: SPLASH_MIN_MS }]);
    expect(later.shown).toEqual([SPLASH_MIN_MS]);
    expect(later.state.phase).toBe("fading");
  });

  it("hands over at once when the window turns out ready after the minimum", () => {
    expect(run([{ type: "start", at: 0 }, { type: "windowReady", at: 1_900 }]).shown).toEqual([1_900]);
  });

  it("never holds the app past 2.5 s, even if the window never reports ready", () => {
    const r = run([{ type: "start", at: 0 }, { type: "tick", at: 2_000 }, { type: "tick", at: SPLASH_CAP_MS }]);
    expect(r.shown).toEqual([SPLASH_CAP_MS]);
  });

  it("fades for 250 ms and then is done; it shows the window once and ignores a second start", () => {
    const r = run([
      { type: "start", at: 0 },
      { type: "windowReady", at: 10 },
      { type: "tick", at: 1_500 },
      { type: "tick", at: 1_500 + SPLASH_FADE_MS - 1 },
    ]);
    expect(r.state.phase).toBe("fading");
    const done = run([{ type: "start", at: 0 }, { type: "windowReady", at: 10 }, { type: "tick", at: 1_500 }, { type: "tick", at: 1_500 + SPLASH_FADE_MS }, { type: "start", at: 5_000 }, { type: "tick", at: 9_000 }]);
    expect(done.state.phase).toBe("done");
    expect(done.shown).toEqual([1_500]);
  });
});

describe("when the splash shows", () => {
  it("only on a cold start the person made, with motion on", () => {
    expect(shouldSplash({ coldStart: true, quietLaunch: false, reducedMotion: false })).toBe(true);
    expect(shouldSplash({ coldStart: false, quietLaunch: false, reducedMotion: false })).toBe(false);
    expect(shouldSplash({ coldStart: true, quietLaunch: true, reducedMotion: false })).toBe(false);
    expect(shouldSplash({ coldStart: true, quietLaunch: false, reducedMotion: true })).toBe(false);
  });
});

describe("the splash window", () => {
  const o = splashWindowOptions({ x: 960, y: 540 });
  it("is small, frameless, transparent, centred, out of the taskbar and never takes focus", () => {
    expect(o).toMatchObject({ width: 192, height: 192, x: 864, y: 444, frame: false, transparent: true, skipTaskbar: true, focusable: false, show: false, hasShadow: false });
    expect(o.webPreferences).toEqual({ contextIsolation: true, nodeIntegration: false, sandbox: true });
  });
  it("holds only the animation, and nothing but base64 can get into the page", () => {
    const html = splashHtml('AAAA"><script>x()</script>');
    expect(html).toContain('src="data:image/webp;base64,AAAAscriptx');
    expect(html).not.toContain("<script");
  });
});
