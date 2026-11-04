import type { AssistantCase } from "./cases.ts";

/** The tool a sample reached for first, without the MCP server prefix; "none" when it used none. */
export const firstTool = (calls: ReadonlyArray<string>): string =>
  (calls[0] ?? "none").replace(/^mcp__baton__/, "");

export const passes = (c: AssistantCase, calls: ReadonlyArray<string>): boolean => {
  const first = firstTool(calls);
  return c.first.includes(first) && !(c.not ?? []).includes(first);
};

/** A case fails when half or more of its samples fail (evals/README.md). */
export const casePasses = (c: AssistantCase, samples: ReadonlyArray<ReadonlyArray<string>>) =>
  samples.filter((calls) => passes(c, calls)).length * 2 > samples.length;
