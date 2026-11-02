/**
 * What the operator may do (D127). The operator is Claude or Codex with its own tools, so it can do
 * anything he could at this keyboard. Each tool call comes here before it runs, whichever harness
 * made it, and code decides. A model's reply can never widen this.
 */
import { highRiskSubject } from "./intentParser.ts";
import { detectSecret } from "./memory.ts";
import { dangerousCommand, sensitiveAction } from "./screenCompanion.ts";
import { isChromeTool, judgeChrome } from "./webPolicy.ts";

export interface ToolCall {
  /** The harness's own name: "Bash", "Write", "commandExecution". */
  readonly tool: string;
  readonly input: Readonly<Record<string, unknown>>;
}

export type ToolVerdict =
  | { readonly verdict: "allow" }
  /** `risky`: needs his explicit yes, no timeout counts as one, and no setting covers it. */
  | { readonly verdict: "ask"; readonly why: string; readonly risky?: true }
  /** Never done, asked or not: money movement, and a social site while social is off. */
  | { readonly verdict: "deny"; readonly why: string };

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
  [
    "command",
    "file_path",
    "path",
    "notebook_path",
    "url",
    "cwd",
    "query",
    "text",
    "value",
    "action",
    "ref",
    "why",
    "keys",
    "target",
    "session",
  ]
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
  /** An earlier weave to this session in this job was approved: later ones are routine (D149). */
  readonly weaveStanding?: boolean;
  /** The window that has the keyboard is a command line, or cannot be told apart from one. */
  readonly focusedShell?: boolean;
  /** The text is his own words or Baton's own earlier reply, found in the conversation. */
  readonly textIsHis?: boolean;
  /** His own Chrome (Claude in Chrome): what the gate knows about the page and the accounts. */
  readonly chrome?: {
    readonly socialOn: boolean;
    readonly pageHost: string | null;
    readonly recentSocial: number;
  };
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
  "memory_used",
  "vault_list",
  "memory_pin",
  "remember_target",
  "wait",
  "wait_for",
  "dictation_start",
  "dictation_stop",
  "screen_capture",
  "ui_tree",
  "jobs_list",
  "watch_report",
  "morning_brief",
  "needs_me",
  "commit_list",
  "notices_resume",
  "weave_list",
  "approvals_list",
  "job_revoke",
  "job_stop",
]);
const BATON_POINTER = new Set(["click", "click_element", "scroll"]);
export const BATON_TOOLS: ReadonlySet<string> = new Set([
  ...BATON_QUIET,
  ...BATON_POINTER,
  "drag",
  "type_text",
  "press_keys",
  "session_send",
  "job_start",
  "job_split",
  "job_refine",
  "job_agree",
  "job_grant",
  "job_schedule",
  "memory_remember",
  "memory_forget",
  "vault_use",
  "vault_save_pending",
  "commit_add",
  "commit_done",
  "notices_stop",
  "weave_send",
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
  "ui_tree",
  "session_show",
  // Another session's reply is data from outside, whatever it says.
  "weave_list",
]);

const SENDS = /\b(enter|return)\b/i;

const NAV_KEYS = new Set([
  "up",
  "down",
  "left",
  "right",
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
  "tab",
  "home",
  "end",
  "pageup",
  "pagedown",
  "backspace",
  "delete",
  "escape",
  "esc",
]);
const EDIT_LETTERS = new Set(["a", "c", "x", "v", "z", "y", "f"]);

/**
 * Keys that carry nothing out and open nothing: navigation, Backspace, Delete, Escape, and Ctrl+A, C, X,
 * V, Z, Y, F, each with Shift or Ctrl only. Anything else asks after a read (a Win+R or Alt+F4 is how
 * an injection would start). Unknown is ask.
 */
export const keyIsNavigation = (keys: ReadonlyArray<string>): boolean => {
  const parts = keys.map((k) => k.toLowerCase().trim());
  const isMod = (k: string) => k === "ctrl" || k === "control" || k === "shift";
  const mods = new Set<string>(parts.filter(isMod));
  const rest = parts.filter((k) => !isMod(k));
  if (rest.length !== 1) return false;
  const main = rest[0]!;
  const ctrl = mods.has("ctrl") || mods.has("control");
  const shift = mods.has("shift");
  if (NAV_KEYS.has(main)) {
    if (main === "escape" || main === "esc") return !(ctrl && shift);
    if ((main === "delete" || main === "backspace") && ctrl && shift) return false;
    return true;
  }
  return EDIT_LETTERS.has(main) && ctrl;
};

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
        return {
          verdict: "ask",
          why: "It would type into a command line, where nobody reads it first.",
        };
      }
      return outgoing
        ? { verdict: "ask", why: "It follows something it read." }
        : { verdict: "allow" };
    case "press_keys":
      if (SENDS.test(Array.isArray(call.input["keys"]) ? call.input["keys"].join(" ") : "")) {
        return { verdict: "ask", why: "That may send what is typed." };
      }
      if (sensitiveAction(text))
        return { verdict: "ask", why: "It deletes, sends, pays or publishes." };
      // After a read, only navigation and editing keys are free (`keyIsNavigation`); the rest ask.
      return context.tainted &&
        !keyIsNavigation(Array.isArray(call.input["keys"]) ? call.input["keys"].map(String) : [])
        ? { verdict: "ask", why: "It follows something it read." }
        : { verdict: "allow" };
    case "job_start":
    case "job_split":
    case "job_refine":
    case "job_agree":
      // A job's words are his own or they came from something it read; only the second asks.
      // Starting work is his agreement, not the model's: after a read it always asks.
      return outgoing || (name === "job_agree" && context.tainted)
        ? { verdict: "ask", why: "It follows something it read." }
        : { verdict: "allow" };
    case "weave_send": {
      // A message to another session never carries a secret, whoever asked for it.
      if (detectSecret(text) !== null) {
        return { verdict: "deny", why: "A message to another session never carries a secret." };
      }
      if (outgoing) return { verdict: "ask", why: "It follows something it read." };
      return context.weaveStanding === true
        ? { verdict: "allow" }
        : { verdict: "ask", why: "It would message another session; the first one in a job needs your yes." };
    }
    case "notices_stop":
    case "commit_add":
    case "commit_done":
    case "memory_remember":
      // A note outlasts the conversation, so words that came from something it read are not kept unasked.
      return outgoing
        ? { verdict: "ask", why: "It would keep something it read as a note or a commitment." }
        : { verdict: "allow" };
    case "vault_use":
      // The vault asks for itself, by the secret's policy and with the name, purpose and target (never the value);
      // a turn that read something is always asked there.
      return { verdict: "allow" };
    case "vault_save_pending":
      return { verdict: "ask", why: "It would keep the secret you just told it in your vault." };
    case "memory_forget":
      return { verdict: "ask", why: "It would delete one of your notes." };
    case "job_schedule":
      // A repeating run is unattended spending, so it asks every time.
      return { verdict: "ask", why: "It would make a job run again on a schedule." };
    case "job_grant":
      // A standing permission is explicit and his alone: it asks every time.
      return { verdict: "ask", why: "It would give a job a standing permission.", risky: true };
    case "session_send":
      // The intent layer applies the same gates as typing it; a secret carried out is the risk here.
      return outgoing
        ? { verdict: "ask", why: "It follows something it read." }
        : { verdict: "allow" };
    default:
      return { verdict: "ask", why: `It wants to use ${call.tool}.` };
  }
};

export const judgeToolCall = (call: ToolCall, context: JudgeContext): ToolVerdict => {
  const baton = batonToolName(call.tool);
  if (isChromeTool(call.tool)) {
    return judgeChrome(call.tool, call.input, {
      tainted: context.tainted,
      textIsHis: context.textIsHis === true,
      socialOn: context.chrome?.socialOn ?? false,
      pageHost: context.chrome?.pageHost ?? null,
      recentSocial: context.chrome?.recentSocial ?? 0,
    });
  }
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
    return { verdict: "ask", why: "Tessaya cannot see what this command is." };
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
  title: judged.risky ? "This one is risky" : "Tessaya wants to do this",
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
