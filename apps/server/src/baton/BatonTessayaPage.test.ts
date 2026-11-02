import { describe, expect, it } from "vite-plus/test";

import { HTML, MANIFEST, SCRIPT, SERVICE_WORKER } from "./BatonTessayaPage.ts";

describe("the phone page files", () => {
  it("has a script and a service worker that parse, and a page with no inline script", () => {
    expect(() => new Function(SCRIPT)).not.toThrow();
    expect(() => new Function(SERVICE_WORKER)).not.toThrow();
    expect(HTML).toContain('<script src="/tessaya/app.js"></script>');
    expect(HTML).not.toMatch(/<script>/);
  });
  it("is installable: a manifest whose start page is inside its scope, with the Woad icon set", () => {
    const m = JSON.parse(MANIFEST) as { start_url: string; scope: string; display: string; icons: Array<{ src: string; purpose?: string }> };
    expect(m.start_url.startsWith(m.scope)).toBe(true);
    expect(m.display).toBe("standalone");
    expect(m.icons.map((i) => i.src)).toEqual(["/icon-192.png", "/icon-512.png", "/maskable-512.png"]);
  });
  it("sets text only through textContent, never innerHTML", () => {
    expect(SCRIPT).not.toContain("innerHTML");
  });
});
