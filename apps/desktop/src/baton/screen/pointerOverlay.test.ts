// @effect-diagnostics nodeBuiltinImport:off
import * as NodeVM from "node:vm";

import { describe, expect, it } from "vite-plus/test";

import { OVERLAY_DOCUMENT, shapeFor } from "./pointerOverlay.ts";

describe("the overlay page", () => {
  it("has a script that parses, since a stray escape only shows at run time", () => {
    const script = /<script>([\s\S]*)<\/script>/.exec(OVERLAY_DOCUMENT)?.[1] ?? "";
    expect(script.length).toBeGreaterThan(500);
    expect(() => new NodeVM.Script(script)).not.toThrow();
  });

  it("never repaints on its own: nothing loops, and reduced motion stills the rest", () => {
    expect(OVERLAY_DOCUMENT).not.toMatch(/infinite/);
    const calm = OVERLAY_DOCUMENT.slice(
      OVERLAY_DOCUMENT.indexOf("@media (prefers-reduced-motion:reduce)"),
    );
    expect(calm).toContain("#trail{display:none}");
    expect(calm).toContain("#ring.pulse,.mk.now{animation:none}");
    expect(OVERLAY_DOCUMENT).toMatch(/#ring\.pulse\{animation:soft \.9s ease-out 1\}/);
  });

  it("keeps the Woad tokens as variables, and the highlight two-tone so it reads on light and dark", () => {
    expect(OVERLAY_DOCUMENT).toContain("--tz-dye:#14505A");
    expect(OVERLAY_DOCUMENT).toContain("--tz-glow:#5FB3B3");
    expect(OVERLAY_DOCUMENT).toMatch(/#ring\{[^}]*0 0 0 2px #fff,0 0 0 4px var\(--tz-ink\)/);
  });
});

describe("what is drawn round a control", () => {
  it("is a ring for a button or menu and a dashed box for a field or an area", () => {
    expect(shapeFor({ width: 66, height: 28 })).toBe("ring");
    expect(shapeFor({ width: 300, height: 34 })).toBe("box");
    expect(shapeFor({ width: 120, height: 200 })).toBe("box");
  });
});
