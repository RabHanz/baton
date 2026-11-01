/**
 * What the operator may do (D127). The operator is Claude or Codex with its own tools, so it can do
 * anything he could at this keyboard. Each tool call comes here before it runs, whichever harness
 * made it, and code decides. A model's reply can never widen this.
 */
import { highRiskSubject } from "./intentParser.ts";
import { dangerousCommand, sensitiveAction } from "./screenCompanion.ts";

export interface ToolCall {
  /** The harness's own name: "Bash", "Write", "commandExecution". */
  readonly tool: string;
  readonly input: Readonly<Record<string, unknown>>;
}

export type ToolVerdict =
  | { readonly verdict: "allow" }
  /** `risky`: needs his explicit yes, no timeout counts as one, and no setting covers it. */
  | { readonly verdict: "ask"; readonly why: string; readonly risky?: true };

/** Only looks. */
const READING = new Set(["Read", "Glob", "Grep", "LS"]);
/** Does something ordinary. "Act without asking" can cover these. */
const ROUTINE = new Set([
  "Bash",
  "Edit",
  "Write",
  "NotebookEdit",
  "WebFetch",
  "commandExecution",
  "fileChange",
  "WebSearch",
]);

/** The parts that say what happens. A file's contents can say "delete everything" and do nothing. */
const actionText = ({ input }: ToolCall): string =>
  ["command", "file_path", "path", "notebook_path", "url", "cwd", "query", "text", "why", "keys", "target"]
    .flatMap((key) => {
      const value = input[key];
      return typeof value === "string" ? [value] : Array.isArray(value) ? value.map(String) : [];
    })
    .join(" ");

/** One short line for a box, the spoken question and the log. Never a file's contents. */
export const describeToolCall = (call: ToolCall): string => {
  const what = actionText(call);
  return (what.length > 0 ? what : call.tool).slice(0, 200);
};

export interface JudgeContext {
  readonly actWithoutAsking: boolean;
  /** This turn has read something, so what it does next may be that content's idea. */
  readonly tainted: boolean;
  /** The window that has the keyboard is a command line, or cannot be told apart from one. */
  readonly focusedShell?: boolean;
  /** The text is his own words or Baton's own earlier reply, found in the conversation. */
  readonly textIsHis?: boolean;
}

/** Baton's own tools, served to the one assistant (D143). Claude names them `mcp__baton__<name>`. */
export const BATON_TOOL_PREFIX = "mcp__baton__";
export const batonToolName = (tool: string): string =>
  tool.startsWith(BATON_TOOL_PREFIX) ? tool.slice(BATON_TOOL_PREFIX.length) : tool;

/** Look at state, or reversible and local: nothing leaves, nothing is changed. */
const BATON_QUIET = new Set([
  "sessions_list",
  "session_show",
  "fleet_status",
  "memory_search",
  "remember_target",
  "wait",
  "wait_for",
  "dictation_start",
  "dictation_stop",
  "screen_capture",
]);
const BATON_POINTER = new Set(["click", "click_element", "scroll"]);
export const BATON_TOOLS: ReadonlySet<string> = new Set([
  ...BATON_QUIET,
  ...BATON_POINTER,
  "drag",
  "type_text",
  "press_keys",
  "session_send",
]);
/** What leaves the machine's own state and, run, taints what follows. */
export const READS_OUTSIDE = new Set([
  "Read",
  "Glob",
  "Grep",
  "LS",
  "Bash",
  "WebFetch",
  "WebSearch",
  "commandExecution",
  "screen_capture",
  "session_show",
]);

const SENDS = /\b(enter|return)\b/i;

const judgeBatonTool = (name: string, call: ToolCall, context: JudgeContext): ToolVerdict => {
  // Screen capture asks for its own consent where it runs; looking is not the risk.
  if (BATON_QUIET.has(name)) return { verdict: "allow" };
  const text = actionText(call);
  const subject = highRiskSubject(text);
  if (subject !== null) return { verdict: "ask", why: `This is ${subject}.`, risky: true };
  if (dangerousCommand(text))
    return { verdict: "ask", why: "This is a destructive command.", risky: true };
  if (BATON_POINTER.has(name)) {
    return sensitiveAction(text)
      ? { verdict: "ask", why: "It deletes, sends, pays or publishes." }
      : { verdict: "allow" };
  }
  const outgoing = context.tainted && context.textIsHis !== true;
  switch (name) {
    case "drag":
      return { verdict: "ask", why: "It wants to drag something." };
    case "type_text":
      // Plain text into a box he named is routine and needs no Run it. A command line, or words
      // that came from something it read, is not.
      if (context.focusedShell === true) {
        return { verdict: "ask", why: "It would type into a command line, where nobody reads it first." };
      }
      return outgoing ? { verdict: "ask", why: "It follows something it read." } : { verdict: "allow" };
    case "press_keys":
      if (SENDS.test(Array.isArray(call.input["keys"]) ? call.input["keys"].join(" ") : "")) {
        return { verdict: "ask", why: "That may send what is typed." };
      }
      // A key or a chord carries nothing out; only Enter, which may send, and the sensitive ones ask.
      return sensitiveAction(text)
        ? { verdict: "ask", why: "It deletes, sends, pays or publishes." }
        : { verdict: "allow" };
    case "session_send":
      // The intent layer applies the same gates as typing it; a secret carried out is the risk here.
      return outgoing ? { verdict: "ask", why: "It follows something it read." } : { verdict: "allow" };
    default:
      return { verdict: "ask", why: `It wants to use ${call.tool}.` };
  }
};

export const judgeToolCall = (call: ToolCall, context: JudgeContext): ToolVerdict => {
  const baton = batonToolName(call.tool);
  if (BATON_TOOLS.has(baton)) return judgeBatonTool(baton, call, context);
  if (READING.has(call.tool)) return { verdict: "allow" };
  const text = actionText(call);
  const subject = highRiskSubject(text);
  if (subject !== null) return { verdict: "ask", why: `This is ${subject}.`, risky: true };
  if (dangerousCommand(text))
    return { verdict: "ask", why: "This is a destructive command.", risky: true };
  // Codex sends no file name Baton can judge, so an edit is never waved through.
  if (call.tool === "fileChange") return { verdict: "ask", why: "It wants to change files." };
  if (call.tool === "commandExecution" && !String(call.input["command"] ?? "").trim())
    return { verdict: "ask", why: "Baton cannot see what this command is." };
  if (!ROUTINE.has(call.tool)) return { verdict: "ask", why: `It wants to use ${call.tool}.` };
  if (sensitiveAction(text))
    return { verdict: "ask", why: "It deletes, sends, pays or publishes." };
  if (context.tainted) return { verdict: "ask", why: "It follows something it read." };
  // A search query is outgoing text, so a tainted turn could be carrying a secret out in it.
  if (call.tool === "WebSearch" && !context.tainted) return { verdict: "allow" };
  return context.actWithoutAsking
    ? { verdict: "allow" }
    : { verdict: "ask", why: "Act without asking is off." };
};

/**
 * A call is announced before its own request reaches the gate. It follows something this turn read
 * or ran when any earlier call was not a web search; a search reads nothing private, so searching
 * again (a follow-up fact) stays untainted.
 */
export const announceTool = (ran: number, tool: string) => ({
  tainted: ran > 0,
  ran: tool === "WebSearch" ? ran : ran + 1,
});

/** What the gate says out loud and shows. A risky call's question that runs out is a no. */
export const gatePrompt = (judged: Extract<ToolVerdict, { verdict: "ask" }>, action: string) => ({
  title: judged.risky ? "This one is risky" : "Baton wants to do this",
  detail: `${action}\n\n${judged.why}`,
  spoken:
    judged.risky === true
      ? `${judged.why} Do you want me to do it? Say yes or no.`
      : `${judged.why} Shall I go ahead? Yes or no.`,
  noOnExpiry: judged.risky === true,
});

/** What a spoken answer decides: the button index, or null to go on waiting for the box. */
export const spokenOutcome = (
  said: "yes" | "no" | "expired",
  option: { readonly yes: number; readonly cancel: number; readonly noOnExpiry: boolean },
): number | null =>
  said === "expired" && !option.noOnExpiry ? null : said === "yes" ? option.yes : option.cancel;
