import { describe, expect, it } from "vite-plus/test";

import { createAgentGate, createTaint } from "./agentGate.ts";

const rig = (outside: boolean) => {
  const asked: string[] = [];
  const taint = createTaint();
  const gate = createAgentGate({
    actWithoutAsking: () => true,
    taint,
    textIsHis: () => true,
    outside: () => outside,
    focusedWindow: async () => ({ label: "notepad.exe: notes", shell: false }),
    confirm: async (p) => (asked.push(p.title), true),
    record: () => undefined,
  });
  taint.reset("tell the build session to rerun the tests");
  return { gate, asked };
};
const send = {
  tool: "mcp__baton__session_send",
  input: { id: "build", text: "rerun the tests" },
};
const typing = { tool: "mcp__baton__type_text", input: { text: "rerun the tests", why: "w" } };

describe("words a paired device or agent left, not his", () => {
  it("are never his: what his own words would do quietly asks him first", async () => {
    const his = rig(false);
    await his.gate(send);
    await his.gate(typing);
    expect(his.asked).toEqual([]);

    const device = rig(true);
    await device.gate(send);
    await device.gate(typing);
    expect(device.asked).toHaveLength(2);
  });
});
