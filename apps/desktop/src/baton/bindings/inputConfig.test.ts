import { parseInputBindings } from "@t3tools/baton-shared/inputBindings";
import { describe, expect, it } from "vite-plus/test";

import { mouseHookConfig } from "./inputConfig.ts";

describe("what the mouse hook is told", () => {
  it("lists only the mouse bindings, in the hook's schema, and nothing for an unbound button", () => {
    const config = mouseHookConfig([
      { def: { id: "wake" }, input: { type: "mouse", button: "middle" } },
      { def: { id: "ask" }, input: { type: "mouse", button: "left+right" } },
      { def: { id: "mute" }, input: { type: "key", accelerator: "Ctrl+Alt+M" } },
      { def: { id: "stop" }, input: null },
      { def: { id: "clear" }, input: { type: "mouse", button: "back" } },
    ]);
    expect(config.bindings).toEqual([
      { id: "wake", action: "listen_start", trigger: { kind: "button", button: "middle" } },
      { id: "ask", action: "ask", trigger: { kind: "chord", buttons: ["left", "right"] } },
      { id: "clear", action: "clear_screen", trigger: { kind: "button", button: "x1" } },
    ]);
    expect(parseInputBindings(JSON.parse(JSON.stringify(config))).bindings).toHaveLength(3);
    expect(mouseHookConfig([]).bindings).toEqual([]);
  });
});
