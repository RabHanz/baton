import { describe, expect, it } from "vite-plus/test";

import { tabOf } from "./tabs.ts";

describe("where each control lives", () => {
  it("puts every control the window has today on its tab", () => {
    expect(tabOf("v.wake:sebastian")).toBe("voice");
    expect(tabOf("v.result:mic")).toBe("checks");
    expect(tabOf("n:claude:abc")).toBe("sessions");
    expect(tabOf("u.act:later")).toBe("settings");
    expect(tabOf("s.capture")).toBe("screen");
    expect(tabOf("s.act")).toBe("assistant");
    expect(tabOf("v.appMode")).toBe("dictation");
    expect(tabOf("trust.revoke:chrome")).toBe("trust");
    expect(tabOf("tr.enabled")).toBe("transforms");
  });
  it("sends an id it does not know to Settings, not nowhere", () => {
    expect(tabOf("x.new")).toBe("settings");
  });
});
