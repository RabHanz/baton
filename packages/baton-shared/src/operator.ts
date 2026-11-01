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
  ["command", "file_path", "path", "notebook_path", "url", "cwd", "query"]
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

export const judgeToolCall = (
  call: ToolCall,
  context: {
    readonly actWithoutAsking: boolean;
    /** This turn has read something, so what it does next may be that content's idea. */
    readonly tainted: boolean;
  },
): ToolVerdict => {
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
