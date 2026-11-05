import type { AssistantCase } from "./cases.ts";

/** The tool a sample reached for first, without the MCP server prefix; "none" when it used none. */
export const firstTool = (calls: ReadonlyArray<string>): string =>
  (calls[0] ?? "none").replace(/^mcp__baton__/, "");

export interface Sample {
  readonly calls: ReadonlyArray<string>;
  readonly reply: string;
}

export const passes = (c: AssistantCase, sample: Sample): boolean => {
  const first = firstTool(sample.calls);
  return (
    c.first.includes(first) &&
    !(c.not ?? []).includes(first) &&
    (c.says === undefined || sample.reply.toLowerCase().includes(c.says.toLowerCase()))
  );
};

/** A case fails when half or more of its samples fail (evals/README.md). */
export const casePasses = (c: AssistantCase, samples: ReadonlyArray<Sample>) =>
  samples.filter((sample) => passes(c, sample)).length * 2 > samples.length;
