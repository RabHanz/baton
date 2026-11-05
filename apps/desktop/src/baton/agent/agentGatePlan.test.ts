import { describe, expect, it } from "vite-plus/test";

import { createAgentGate, createTaint } from "./agentGate.ts";

const rig = (plan: boolean, shell = false) => {
  const asked: string[] = [];
  const allowedKeys: unknown[] = [];
  const taint = createTaint();
  const gate = createAgentGate({
    actWithoutAsking: () => true,
    taint,
    textIsHis: () => false,
    focusedWindow: async () => ({
      label: shell ? "powershell.exe: PS" : "notepad.exe: notes",
      shell,
      window: 7,
    }),
    confirm: async (p) => (asked.push(p.title), true),
    record: () => undefined,
    inPlan: () => plan,
    keysAllowed: (at) => void allowedKeys.push(at),
  });
  return { gate, asked, taint, allowedKeys };
};
const call = (tool: string, input: Record<string, unknown>) => ({
  tool: `mcp__baton__${tool}`,
  input,
});

describe("a plan he approved", () => {
  it("covers its steps that would ask, and keeps asking for what is risky or reaches a command line", async () => {
    const r = rig(true);
    r.taint.mark();
    // After a read, typing and Enter ask; inside his plan they do not.
    await r.gate(call("type_text", { text: "hello", why: "w" }));
    await r.gate(call("press_keys", { keys: ["enter"], why: "save" }));
    await r.gate(call("drag", { x: 1, y: 1, to_x: 2, to_y: 2, why: "move" }));
    expect(r.asked).toEqual([]);
    await r.gate(call("click_element", { label: "Send", why: "send the email" }));
    expect(r.asked).toHaveLength(1);
    const shell = rig(true, true);
    await shell.gate(call("type_text", { text: "dir", why: "w" }));
    expect(shell.asked).toHaveLength(1);
  });

  it("covers nothing without his yes to a plan", async () => {
    const r = rig(false);
    r.taint.mark();
    await r.gate(call("type_text", { text: "hello", why: "w" }));
    expect(r.asked).toHaveLength(1);
  });

  it("notes where keys were allowed, so they are checked again as they are sent", async () => {
    const r = rig(false);
    await r.gate(call("type_text", { text: "hello", why: "w" }));
    await r.gate(call("click_element", { label: "OK", why: "w" }));
    expect(r.allowedKeys).toEqual([{ window: 7, label: "notepad.exe: notes", shell: false }]);
  });
});
