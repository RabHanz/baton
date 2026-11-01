import { describe, expect, it } from "vite-plus/test";

import { claudeAccountInstances } from "./ClaudeAccountInstances.ts";

describe("which instances run on which slot", () => {
  it("is empty on a machine with no such instances and no setting", () => {
    expect(claudeAccountInstances(undefined, ["claudeAgent", "codex"])).toEqual({});
  });
  it("keeps the old behaviour where the old instances exist and nothing is set", () => {
    expect(
      claudeAccountInstances(undefined, ["claudeAgent", "claudeAgent_optima", "claudeAgent_rabee"]),
    ).toEqual({ claudeAgent_optima: "5", claudeAgent_rabee: "4" });
  });
  it("lets the environment win, and ignores an unreadable one", () => {
    expect(claudeAccountInstances('{"claudeAgent_work":"2"}', ["claudeAgent_optima"])).toEqual({
      claudeAgent_work: "2",
    });
    expect(claudeAccountInstances("not json", ["claudeAgent_optima"])).toEqual({
      claudeAgent_optima: "5",
    });
  });
});
