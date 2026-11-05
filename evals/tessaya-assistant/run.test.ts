import { describe, expect, it } from "vite-plus/test";

import type { AssistantCase } from "./cases.ts";
import { casePasses, firstTool, passes } from "./grade.ts";

const c: AssistantCase = {
  id: "t",
  source: "test",
  said: "tell the build session to rerun the tests",
  first: ["sessions_list", "session_send"],
  not: ["weave_send"],
};

describe("the assistant eval's grader", () => {
  it("reads the first tool, with the MCP prefix off, and none when there was none", () => {
    expect(firstTool(["mcp__baton__needs_me", "Read"])).toBe("needs_me");
    expect(firstTool([])).toBe("none");
  });

  const s = (...calls: string[]) => ({ calls, reply: "" });
  it("passes an accepted first tool and fails a wrong one", () => {
    expect(passes(c, s("mcp__baton__sessions_list"))).toBe(true);
    expect(passes(c, s("mcp__baton__weave_send"))).toBe(false);
    expect(passes(c, s())).toBe(false);
  });

  it("fails a reply that leaves out the words the case needs", () => {
    const named = { ...c, first: ["none"], says: "Freya" };
    expect(passes(named, { calls: [], reply: "Freya here. It's ten." })).toBe(true);
    expect(passes(named, { calls: [], reply: "It's ten." })).toBe(false);
  });

  it("fails a case when half or more of its samples fail", () => {
    expect(casePasses(c, [s("mcp__baton__session_send"), s()])).toBe(false);
    expect(casePasses(c, [s("mcp__baton__session_send"), s("mcp__baton__session_send"), s()])).toBe(
      true,
    );
  });
});
