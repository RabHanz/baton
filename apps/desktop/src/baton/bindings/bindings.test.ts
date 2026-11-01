import { describe, expect, it } from "vite-plus/test";

import {
  effective,
  normaliseAccelerator,
  parseBindings,
  toElectronAccelerator,
  withBinding,
} from "./bindings.ts";

describe("bindings", () => {
  it("spells a chord one way, whatever the order or the names", () => {
    expect(normaliseAccelerator("Control+shift+space")).toBe("Ctrl+Shift+Space");
    expect(normaliseAccelerator("Alt+Win+x")).toBe("Alt+Meta+X");
    expect(toElectronAccelerator("Ctrl+Alt+Space")).toBe("Control+Alt+Space");
  });
  it("starts with the defaults, and a cleared row is off on purpose", () => {
    const rows = effective([]);
    expect(rows.find((r) => r.def.id === "mute")!.input).toEqual({
      type: "key",
      accelerator: "Ctrl+Alt+Shift+F7",
    });
    expect(rows.find((r) => r.def.id === "stop")!.input).toBeNull();
    const off = effective(withBinding([], "mute", null));
    expect(off.find((r) => r.def.id === "mute")).toMatchObject({ input: null, isDefault: false });
  });
  it("names the other action that has the same key or button", () => {
    const rows = effective([
      { action: "stop", input: { type: "key", accelerator: "shift+ctrl+alt+f7" } },
      { action: "clear", input: { type: "mouse", button: "middle" } },
      { action: "ask", input: { type: "mouse", button: "middle" } },
    ]);
    expect(rows.find((r) => r.def.id === "mute")!.conflictsWith).toEqual(["Stop"]);
    expect(rows.find((r) => r.def.id === "clear")!.conflictsWith).toEqual(["Ask Baton"]);
    expect(rows.find((r) => r.def.id === "wake")!.conflictsWith).toEqual([]);
  });
  it("reads a saved list without trusting it, and resets one action", () => {
    const parsed = parseBindings([
      { action: "mute", input: { type: "key", accelerator: "control+m" } },
      { action: "bogus", input: null },
      { action: "ask", input: { type: "mouse", button: "wheel" } },
      { action: "stop", input: null },
    ]);
    expect(parsed).toEqual([
      { action: "mute", input: { type: "key", accelerator: "Ctrl+M" } },
      { action: "stop", input: null },
    ]);
    expect(withBinding(parsed, "mute", "reset")).toEqual([{ action: "stop", input: null }]);
  });
  it("lets the dictation keys come from their own settings", () => {
    const rows = effective([], { hold: { type: "key", accelerator: "Ctrl+Alt+H" } });
    expect(rows.find((r) => r.def.id === "hold")!.input).toEqual({
      type: "key",
      accelerator: "Ctrl+Alt+H",
    });
  });
});
