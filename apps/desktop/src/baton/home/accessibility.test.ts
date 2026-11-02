import { describe, expect, it } from "vite-plus/test";

import { PILL_DOCUMENT } from "../voice/voicePill.ts";
import { APP_CSS } from "./appStyle.ts";
import { APP_SCRIPT } from "./appScript.ts";
import { HOME_DOCUMENT } from "./homeDocument.ts";

describe("the window's accessibility", () => {
  it("has landmarks, a skip link and a named navigation", () => {
    expect(HOME_DOCUMENT).toContain('<a class="skip" href="#panel">');
    expect(HOME_DOCUMENT).toContain('<aside id="side" aria-label="Sidebar">');
    expect(HOME_DOCUMENT).toContain('<main id="panel"');
    expect(HOME_DOCUMENT).toContain('<header id="top">');
    expect(APP_SCRIPT).toContain("nav.setAttribute('aria-label', 'Tessaya pages')");
    expect(APP_SCRIPT).toContain("setAttribute('aria-current', 'page')");
  });
  it("makes the settings dialog modal: named, focus moved in and back, Tab kept inside, Escape closes", () => {
    expect(APP_SCRIPT).toContain("setAttribute('aria-modal', 'true')");
    expect(APP_SCRIPT).toContain("modalOpener = document.activeElement");
    expect(APP_SCRIPT).toContain("modalOpener.focus()");
    expect(APP_SCRIPT).toContain("e.key === 'Tab' && modal");
    expect(APP_SCRIPT).toContain("e.key === 'Escape' && modal");
  });
  it("shows a focus ring on every kind of control and honours reduced motion", () => {
    for (const kind of ["button", "select", "input", "textarea", "a", "[tabindex]"]) {
      expect(APP_CSS).toContain(`${kind}:focus-visible`);
    }
    expect(APP_CSS).toContain("@media (prefers-reduced-motion:reduce)");
    // An outline may be removed only on a rule that is itself about focus, where something else shows it.
    const css = APP_CSS.replace(/url\([^)]*\)/g, "url()");
    const bare = [...css.matchAll(/([^{}]+)\{([^{}]*outline:\s*(?:none|0)\b[^{}]*)\}/g)].filter(
      (m) => !m[1]!.includes(":focus"),
    );
    expect(bare.map((m) => m[1])).toEqual([]);
  });
  it("gives a switch, a radio and an icon button an accessible name", () => {
    // Every script-made icon button is given an aria-label right after it is made.
    const made = [...APP_SCRIPT.matchAll(/(\w+) = \$\('button', 'ibtn'\);/g)].map((m) => m[1]!);
    expect(made.length).toBeGreaterThanOrEqual(5);
    for (const v of made) expect(APP_SCRIPT).toContain(`${v}.setAttribute('aria-label'`);
    expect(APP_SCRIPT).toContain("setAttribute('role', 'switch')");
    expect(APP_SCRIPT).toContain("setAttribute('role', 'radio')");
  });
  it("announces the pill's state to a screen reader, in words, and stops moving for reduced motion", () => {
    expect(PILL_DOCUMENT).toContain('role="status" aria-live="polite"');
    expect(PILL_DOCUMENT).toContain('<span id="sr" class="sr"></span>');
    expect(PILL_DOCUMENT).toContain("$('sr').textContent=v.label");
    expect(PILL_DOCUMENT).toContain("@media (prefers-reduced-motion:reduce)");
  });
});

describe("the top bar takes clicks", () => {
  it("keeps the drag region to empty space: every control inside #top is no-drag", () => {
    expect(APP_CSS).toMatch(/#top\{[^}]*-webkit-app-region:drag/);
    const rule = APP_CSS.match(/(#top [^{}]*)\{-webkit-app-region:no-drag\}/)?.[1] ?? "";
    for (const selector of ["#top button", "#top input", "#top select", "#top a", "#top .state"]) {
      expect(rule).toContain(selector);
    }
  });
});

describe("the mark shows once", () => {
  it("is not drawn a second time on Home", () => {
    expect(APP_SCRIPT).not.toContain("homemark");
    expect(APP_CSS).not.toContain("homemark");
  });
});

describe("the mark breathes only while the window is in front", () => {
  it("animates transform and opacity only, behind the live gate, and the gate follows focus and visibility", () => {
    expect(APP_CSS).toMatch(/@keyframes breathe\{[^@]*transform:scale\(1\.035\)/);
    expect(APP_CSS).not.toMatch(/(?<!html\.live )\.brand #mark\{[^}]*animation:/);
    expect(APP_CSS).toMatch(/html\.live \.brand #mark\{animation:breathe 6s/);
    for (const event of ["'focus'", "'blur'", "'visibilitychange'"]) expect(APP_SCRIPT).toContain(event);
    expect(APP_CSS).toMatch(/prefers-reduced-motion:reduce\)\{\*\{[^}]*animation:none/);
  });
});
