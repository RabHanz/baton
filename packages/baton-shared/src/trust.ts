/**
 * One Trust: the one function that answers "may this agent do this now?". The base rules are `judgeToolCall`; a plan
 * he approved may lift only the asks `PLAN_SKIPS` names, for its own steps; a persona's tool list can only narrow
 * what is left. Nothing here widens the base rules.
 */
import {
  BATON_TOOL_PREFIX,
  batchSteps,
  batonToolName,
  judgeToolCall,
  type JudgeContext,
  type ToolCall,
  type ToolVerdict,
} from "./operator.ts";
import type { ProjectRef } from "./osPack.ts";

/** Who is asking: a persona from the roster. `tools: null` is no list of its own, so only the base rules apply. */
export interface TrustAgent {
  readonly name: string;
  readonly tools: ReadonlyArray<string> | null;
  /** Only the lead hands out work (decision 2026-11-05). */
  readonly lead: boolean;
  /** Whether it leads this project (a project's own lead); absent is none. */
  readonly leadsProject?: (project: ProjectRef) => boolean;
}

/** Tools that hand work to another agent: the lead's alone. */
export const DELEGATING_TOOLS: ReadonlySet<string> = new Set([
  "job_start",
  "job_split",
  "job_handoff",
  "job_schedule",
  "cloud_dispatch",
]);

export interface TrustAsk {
  readonly call: ToolCall;
  readonly context: JudgeContext;
  readonly agent?: TrustAgent;
  /** The steps of a plan he approved this turn (plan_show). */
  readonly plan?: ReadonlyArray<string> | null;
  /** The projects of the job a job_split, job_handoff or job_schedule names; null when it could not be read. */
  readonly jobProjects?: ReadonlyArray<ProjectRef> | null;
}

export type TrustVerdict = ToolVerdict | { readonly verdict: "allow"; readonly inPlan: true };

/**
 * The only reasons a plan he approved may skip, and for which steps: typing after a read, and a drag. Keys never (Enter
 * sends; Win, Alt and other chords open things), nor what deletes, sends, pays, publishes or reaches a command line.
 */
const PLAN_SKIPS: Readonly<Record<string, ReadonlySet<string>>> = {
  type_text: new Set(["It follows something it read."]),
  drag: new Set(["It wants to drag something."]),
};

/**
 * Whether a hands step is one he approved: the text it types is a step's quoted text, or a whole phrase of a step at
 * least three characters long (a letter at a time, or a word inside another, would smuggle text past the plan); a drag
 * only where a step says drag.
 */
export const inApprovedSteps = (
  steps: ReadonlyArray<string>,
  tool: string,
  args: Readonly<Record<string, unknown>>,
): boolean => {
  const words = steps.join("\n").toLowerCase();
  if (tool === "drag") return /\bdrag\b/.test(words);
  if (tool !== "type_text" || typeof args["text"] !== "string") return false;
  const text = args["text"].trim().toLowerCase();
  if (text === "") return false;
  const quoted = [...words.matchAll(/["“”]([^"“”]+)["“”]/g)].some((m) => m[1]!.trim() === text);
  if (quoted) return true;
  const phrase = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    text.length >= 3 &&
    new RegExp(`(^|[^\\p{L}\\p{N}])${phrase}($|[^\\p{L}\\p{N}])`, "u").test(words)
  );
};

/** A batch is covered only when every step is, each judged alone (a batch's own verdict keeps one reason of several). */
const planCovers = (
  call: ToolCall,
  context: JudgeContext,
  plan: ReadonlyArray<string>,
): boolean => {
  if (!call.tool.startsWith(BATON_TOOL_PREFIX) || context.focusedShell === true) return false;
  const covered = (tool: string, args: Readonly<Record<string, unknown>>) => {
    const one = judgeToolCall({ tool: `${BATON_TOOL_PREFIX}${tool}`, input: args }, context);
    return (
      one.verdict === "allow" ||
      (one.verdict === "ask" &&
        one.risky !== true &&
        PLAN_SKIPS[tool]?.has(one.why) === true &&
        inApprovedSteps(plan, tool, args))
    );
  };
  const name = batonToolName(call.tool);
  if (name !== "act_batch") return covered(name, call.input);
  const steps = batchSteps(call.input) ?? [];
  return steps.length > 0 && steps.every((s) => covered(s.tool, s.input));
};

/** The tools a call uses: a batch uses itself and each of its steps. */
const toolsUsed = (call: ToolCall): ReadonlyArray<string> => {
  const name = batonToolName(call.tool);
  return name === "act_batch" && call.tool.startsWith(BATON_TOOL_PREFIX)
    ? [name, ...(batchSteps(call.input) ?? []).map((s) => s.tool)]
    : [name];
};

/** Tools a project's own lead may use on a job in a project it leads. */
const PROJECT_JOB_TOOLS: ReadonlySet<string> = new Set([
  "job_split",
  "job_handoff",
  "job_schedule",
]);

/**
 * A project's own lead hands out that project's work only: a job_start in projects it leads with no
 * folders of its own, or a split, handoff or schedule of a job whose projects it all leads. Never the cloud.
 */
const projectLeadMay = (ask: TrustAsk, agent: TrustAgent, tool: string): boolean => {
  const leads = agent.leadsProject;
  if (leads === undefined) return false;
  if (tool === "job_start") {
    const project = ask.call.input["project"];
    const folders = ask.call.input["folders"];
    const runOn = ask.call.input["run_on"];
    return (
      typeof project === "string" &&
      (folders === undefined || (Array.isArray(folders) && folders.length === 0)) &&
      leads({
        title: project,
        computer: typeof runOn === "string" && runOn.trim() !== "" ? runOn : null,
      })
    );
  }
  const projects = ask.jobProjects ?? [];
  return PROJECT_JOB_TOOLS.has(tool) && projects.length > 0 && projects.every(leads);
};

export const decideTrust = (ask: TrustAsk): TrustVerdict => {
  const base = judgeToolCall(ask.call, ask.context);
  const verdict: TrustVerdict =
    base.verdict === "ask" &&
    ask.plan !== null &&
    ask.plan !== undefined &&
    planCovers(ask.call, ask.context, ask.plan)
      ? { verdict: "allow", inPlan: true }
      : base;
  const agent = ask.agent;
  if (verdict.verdict === "deny" || agent === undefined) return verdict;
  if (!agent.lead) {
    const delegates = toolsUsed(ask.call).find(
      (t) => DELEGATING_TOOLS.has(t) && !projectLeadMay(ask, agent, t),
    );
    if (delegates !== undefined)
      return {
        verdict: "deny",
        why: `Only the lead hands out work, and ${agent.name} is not the lead.`,
      };
  }
  if (agent.tools === null) return verdict;
  const mine = new Set(agent.tools.map((t) => t.toLowerCase()));
  const outside = toolsUsed(ask.call).find((t) => !mine.has(t.toLowerCase()));
  return outside === undefined
    ? verdict
    : { verdict: "deny", why: `${outside} is not one of ${agent.name}'s tools.` };
};
