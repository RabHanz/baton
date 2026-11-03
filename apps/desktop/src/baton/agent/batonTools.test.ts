import { BATON_TOOLS } from "@t3tools/baton-shared/operator";
import { describe, expect, it } from "vite-plus/test";

import { buildBatonTools, type ToolHost } from "./batonTools.ts";

const host = (log: string[], windows: string[] = ["w1"]): ToolHost => ({
  windowKey: async () => windows.shift() ?? "w1",
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

  describe("act_batch", () => {
    const batch = (log: string[], windows?: string[]) =>
      new Map(buildBatonTools(host(log, windows)).map((t) => [t.name, t])).get("act_batch")!;
    const click = (label: string) => ({ tool: "click_element", args: { label, why: "w" } });

    it("runs the steps in order and ends with the window's controls", async () => {
      const log: string[] = [];
      const out = await batch(log).run({
        steps: [click("Help"), { tool: "type_text", args: { text: "hi", why: "w" } }],
      });
      expect(log).toEqual(["element Help", "type hi"]);
      expect(out.text).toContain("Button: Save");
    });

    it("stops when the window with the keyboard changes, and says so", async () => {
      const log: string[] = [];
      // start, then the check before step 2 sees another window
      const out = await batch(log, ["w1", "w2"]).run({ steps: [click("Save"), click("Ok")] });
      expect(log).toEqual(["element Save"]);
      expect(out.text).toContain("Stopped before step 2");
    });

    it("stops at the first failure and treats a wait_for timeout as one", async () => {
      const log: string[] = [];
      const tools = buildBatonTools({
        ...host(log),
        waitFor: async () => 'No control named "X" appeared in 3 seconds.',
      });
      const run = tools.find((t) => t.name === "act_batch")!.run;
      const out = await run({
        steps: [{ tool: "wait_for", args: { label: "X", seconds: 3 } }, click("Never")],
      });
      expect(out.text).toContain("FAILED");
      expect(log).toEqual([]);
    });

    it("refuses a step that is not batchable and is absent without window tracking", async () => {
      await expect(batch([]).run({ steps: [{ tool: "drag", args: {} }] })).rejects.toThrow(
        "steps must be",
      );
      const { windowKey: _omit, ...bare } = host([]);
      expect(buildBatonTools(bare).some((t) => t.name === "act_batch")).toBe(false);
    });
  });

  describe("effects", () => {
    const run = (prints: string[], tool: string, args: Record<string, unknown>) => {
      const tools = buildBatonTools({
        ...host([]),
        fingerprint: async () => prints.shift() ?? prints.at(-1) ?? "",
      });
      return tools.find((t) => t.name === tool)!.run(args);
    };
    it("reports a click that changed the controls as confirmed, and one that changed nothing as a suspected no-op", async () => {
      expect((await run(["a", "b"], "click_element", { label: "x", why: "w" })).text).toContain(
        "Effect: confirmed",
      );
      expect(
        (await run(["a", "a", "a", "a"], "click_element", { label: "x", why: "w" })).text,
      ).toContain("suspected_noop");
    });
    it("calls an unchanged key unverifiable, not a failure", async () => {
      expect(
        (await run(["a", "a", "a", "a"], "press_keys", { keys: ["ctrl", "c"], why: "w" })).text,
      ).toContain("unverifiable");
    });
    it("stops a batch at a suspected no-op", async () => {
      const prints = ["a", "a", "a", "a", "z"];
      const tools = buildBatonTools({
        ...host([]),
        fingerprint: async () => prints.shift() ?? "z",
      });
      const out = await tools
        .find((t) => t.name === "act_batch")!
        .run({
          steps: [
            { tool: "click_element", args: { label: "x", why: "w" } },
            { tool: "click_element", args: { label: "y", why: "w" } },
          ],
        });
      expect(out.text).toContain("Stopped: that step seems to have done nothing");
      expect(out.text).not.toContain("2. click_element");
    });
  });
});
