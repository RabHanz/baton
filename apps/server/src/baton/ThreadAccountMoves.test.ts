import { describe, expect, it } from "vite-plus/test";

import { selectionOnInstance, threadHasRunningTurn } from "./ThreadAccountMoves.ts";

describe("threadHasRunningTurn", () => {
  it("holds a move for a turn in progress, not for a queued or finished run", () => {
    expect(threadHasRunningTurn([{ status: "running" }])).toBe(true);
    expect(threadHasRunningTurn([{ status: "waiting" }])).toBe(true);
    expect(threadHasRunningTurn([{ status: "queued" }, { status: "completed" }])).toBe(false);
  });
});

describe("selectionOnInstance", () => {
  it("changes the instance and keeps the model and its options", () => {
    const selection = {
      instanceId: "claudeAgent",
      model: "claude-opus-5",
      options: [{ id: "effort", value: "high" }],
    } as never;
    expect(selectionOnInstance(selection, "claudeAgent_optima")).toEqual({
      instanceId: "claudeAgent_optima",
      model: "claude-opus-5",
      options: [{ id: "effort", value: "high" }],
    });
  });
});
