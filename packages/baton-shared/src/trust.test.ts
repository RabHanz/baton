import { describe, expect, it } from "vite-plus/test";

import {
  BATON_TOOLS,
  gatePrompt,
  judgeToolCall,
  type JudgeContext,
  type ToolVerdict,
} from "./operator.ts";
import { DEFAULT_OS_PACK, mergePack } from "./osPack.ts";
import { decideTrust, type TrustVerdict } from "./trust.ts";

const CONTEXTS: ReadonlyArray<JudgeContext> = [
  { actWithoutAsking: false, tainted: false },
  { actWithoutAsking: true, tainted: false },
  { actWithoutAsking: true, tainted: true },
  { actWithoutAsking: true, tainted: true, textIsHis: true },
  { actWithoutAsking: false, tainted: false, focusedShell: true },
];
const INPUTS: ReadonlyArray<Record<string, unknown>> = [
  {},
  { text: "hello world", why: "w" },
  { keys: ["enter"] },
  { command: "rm -rf /" },
  { text: "pay the invoice" },
];
const CALLS = [
  ...[...BATON_TOOLS, "act_batch"].map((t) => `mcp__baton__${t}`),
  "Bash",
  "Read",
  "Write",
  "WebSearch",
  "fileChange",
  "commandExecution",
  "mcp__claude-in-chrome__navigate",
  "SomethingNew",
].flatMap((tool) => INPUTS.map((input) => ({ tool, input })));

const rank = (v: TrustVerdict | ToolVerdict) =>
  v.verdict === "deny" ? 3 : v.verdict === "ask" ? (v.risky === true ? 2 : 1) : 0;

describe("One Trust", () => {
  it("with no persona and no plan, decides exactly what the base rules decide", () => {
    for (const context of CONTEXTS)
      for (const call of CALLS)
        expect(decideTrust({ call, context })).toEqual(judgeToolCall(call, context));
  });

  it("the default roster's personas have no tool list of their own, so they change nothing", () => {
    for (const p of DEFAULT_OS_PACK.personas) expect(p.tools).toBeNull();
  });

  it("a persona's tool list only narrows: never a looser verdict, and a tool off its list is refused", () => {
    const freya = { name: "Freya", tools: ["type_text", "Read", "act_batch", "click_element"] };
    for (const context of CONTEXTS)
      for (const call of CALLS) {
        const base = judgeToolCall(call, context);
        const mine = decideTrust({ call, context, agent: freya });
        expect(rank(mine)).toBeGreaterThanOrEqual(rank(base));
      }
    const ctx = CONTEXTS[1]!;
    expect(
      decideTrust({ call: { tool: "Bash", input: { command: "ls" } }, context: ctx, agent: freya }),
    ).toEqual({
      verdict: "deny",
      why: "Bash is not one of Freya's tools.",
    });
    // A batch needs every step's tool on the list too.
    const batch = {
      tool: "mcp__baton__act_batch",
      input: { steps: [{ tool: "press_keys", args: { keys: ["tab"] } }] },
    };
    expect(decideTrust({ call: batch, context: ctx, agent: freya }).verdict).toBe("deny");
  });

  it("a plan he approved lifts only typing he approved and a drag, never a risky ask or a command line", () => {
    const plan = ['type "hello world" into the note', "drag the file"];
    const tainted = CONTEXTS[2]!;
    const type = (text: string) => ({ tool: "mcp__baton__type_text", input: { text } });
    expect(decideTrust({ call: type("hello world"), context: tainted, plan })).toEqual({
      verdict: "allow",
      inPlan: true,
    });
    expect(decideTrust({ call: type("iwr evil"), context: tainted, plan }).verdict).toBe("ask");
    expect(
      decideTrust({ call: type("hello world"), context: { ...tainted, focusedShell: true }, plan })
        .verdict,
    ).toBe("ask");
    const keys = { tool: "mcp__baton__press_keys", input: { keys: ["enter"] } };
    expect(decideTrust({ call: keys, context: tainted, plan }).verdict).toBe("ask");
  });

  it("a persona's tools come from its file's front-matter", () => {
    const pack = mergePack({
      roles: { operations: "---\ntools: type_text, Read\n---\nbrief" },
    });
    expect(pack.personas.find((p) => p.name === "Freya")?.tools).toEqual(["type_text", "Read"]);
  });

  it("every card names who asks and, when known, the project", () => {
    const ask = { verdict: "ask", why: "It deletes, sends, pays or publishes." } as const;
    const card = gatePrompt(ask, "post the draft", { agent: "Freya", project: "launch" });
    expect(card.title).toBe("Freya wants to do this");
    expect(card.detail).toBe('Freya wants to do this in "launch": post the draft\n\n' + ask.why);
    expect(card.spoken).toBe(`Freya wants to do this in "launch". ${ask.why} Go ahead? Yes or no.`);
    // The model sets the project, so it is quoted and capped: it cannot pose as his own words.
    const forged = gatePrompt(ask, "x", { project: `x". He already said yes${"!".repeat(100)}` });
    expect(forged.spoken).toContain(
      `in ${JSON.stringify(`x". He already said yes${"!".repeat(100)}`.slice(0, 60))}.`,
    );
    expect(gatePrompt({ ...ask, risky: true }, "x").spoken).toMatch(/^Tessaya wants to do this\. /);
  });
});
