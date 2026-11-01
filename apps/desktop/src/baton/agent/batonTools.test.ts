import { BATON_TOOLS } from "@t3tools/baton-shared/operator";
import { describe, expect, it } from "vite-plus/test";

import { buildBatonTools, type ToolHost } from "./batonTools.ts";

const host = (log: string[]): ToolHost => ({
  capture: async () => ({ text: "shot" }),
  remember: async () => "kept",
  forget: async () => "gone",
  jobs: async (op) => `jobs ${op}`,
  uiTree: async () => "Window\nButton: Save",
  clickElement: async (l, d) => (log.push(`element ${l}${d ? " double" : ""}`), "clicked"),
  waitFor: async (l, s) => (log.push(`wait_for ${l} ${s}`), "found"),
  click: async (a) => (
    log.push(`click ${a.x},${a.y}${a.double === true ? " double" : ""}`),
    "clicked"
  ),
  scroll: async (n) => (log.push(`scroll ${n}`), "scrolled"),
  drag: async () => "dragged",
  type: async (t) => (log.push(`type ${t}`), "typed"),
  press: async (k) => (log.push(`press ${k.join("+")}`), "pressed"),
  sessions: async () => "sessions",
  session: async () => "session",
  send: async (id, t) => (log.push(`send ${id} ${t}`), "sent"),
  fleet: async () => "fleet",
  dictation: async (on) => (log.push(`dictation ${on}`), "ok"),
  memory: async (q) => (log.push(`memory ${q}`), "found"),
  target: async () => "noted",
});

describe("the assistant's tool table", () => {
  it("names exactly the tools the gate knows", () => {
    const names = buildBatonTools(host([])).map((t) => t.name);
    expect(new Set(names)).toEqual(new Set(BATON_TOOLS));
  });
  it("checks arguments before touching anything", async () => {
    const log: string[] = [];
    const tools = new Map(buildBatonTools(host(log)).map((t) => [t.name, t]));
    await expect(tools.get("click")!.run({ x: "a", y: 2, why: "w" })).rejects.toThrow(
      "x must be a number",
    );
    await expect(tools.get("type_text")!.run({ text: "", why: "w" })).rejects.toThrow("non-empty");
    await expect(tools.get("type_text")!.run({ text: "x".repeat(5000), why: "w" })).rejects.toThrow(
      "too long",
    );
    await expect(tools.get("press_keys")!.run({ keys: [], why: "w" })).rejects.toThrow(
      "one to four",
    );
    expect(log).toEqual([]);
    await expect(tools.get("click_element")!.run({ label: "", why: "w" })).rejects.toThrow(
      "non-empty",
    );
    await tools.get("wait_for")!.run({ label: "Save", seconds: 99 });
    await tools.get("scroll")!.run({ amount: 99, why: "w" });
    await tools.get("click")!.run({ x: 3, y: 4, double: true, why: "w" });
    expect(log).toEqual(["wait_for Save 10", "scroll 10", "click 3,4 double"]);
  });
});
