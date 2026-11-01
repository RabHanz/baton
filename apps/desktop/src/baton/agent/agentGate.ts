/**
 * The gate for the one assistant's tools (D143). It is the same `judgeToolCall` as the operator's
 * (D127), run INSIDE every tool, so no local process and no harness mode reaches a tool without it.
 * A yes is spoken or clicked; for anything high risk the default is no.
 */
import {
  batonToolName,
  describeToolCall,
  gatePrompt,
  judgeToolCall,
  READS_OUTSIDE,
  type ToolCall,
} from "@t3tools/baton-shared/operator";

export type Gate = (
  call: ToolCall,
) => Promise<{ readonly allow: true } | { readonly allow: false; readonly reason: string }>;

/** Has this turn read something outside the conversation? Reset when a new turn starts. */
/** Where a yes to typing was given for: the window with the keyboard and the box that was clicked. */
export interface TypingScope {
  readonly window: string;
  readonly field: string;
}

export interface TurnTaint {
  readonly mark: () => void;
  readonly on: () => boolean;
  /** His yes to typing covers more typing into the same window and box, until Enter, a send or the turn's end. */
  readonly allowTyping: (scope: TypingScope) => void;
  readonly typingAllowedFor: (scope: TypingScope) => boolean;
  readonly clearTyping: () => void;
  /** The box last clicked this turn: a control's name, or a coarse place. */
  readonly noteField: (field: string) => void;
  readonly field: () => string;
  readonly reset: () => void;
}

export const createTaint = (): TurnTaint => {
  let tainted = false;
  let scope: TypingScope | null = null;
  let field = "";
  return {
    mark: () => void (tainted = true),
    on: () => tainted,
    allowTyping: (next) => void (scope = next),
    typingAllowedFor: (now) =>
      scope !== null && scope.window === now.window && scope.field === now.field,
    clearTyping: () => void (scope = null),
    noteField: (next) => void (field = next),
    field: () => field,
    reset: () => {
      tainted = false;
      scope = null;
      field = "";
    },
  };
};

/** A coarse place for a click by position, so a small slip is still the same box. */
export const fieldOf = (input: Readonly<Record<string, unknown>>): string =>
  typeof input["label"] === "string"
    ? `element:${input["label"].toLowerCase()}`
    : `point:${Math.round(Number(input["x"]) / 60)},${Math.round(Number(input["y"]) / 60)}`;

export interface ConfirmPrompt {
  readonly title: string;
  readonly detail: string;
  readonly spoken: string;
  /** A question that runs out is a no, and no setting covers it. */
  readonly noOnExpiry: boolean;
}

export const createAgentGate = (input: {
  readonly actWithoutAsking: () => boolean;
  readonly taint: TurnTaint;
  /** The text is his own words or Baton's own earlier reply, from the conversation. */
  readonly textIsHis: (text: string) => boolean;
  /** The window with the keyboard: its name, and whether it is a command line or cannot be told apart from one. */
  readonly focusedWindow: () => Promise<{ readonly label: string; readonly shell: boolean }>;
  readonly confirm: (prompt: ConfirmPrompt) => Promise<boolean>;
  readonly record: (entry: Readonly<Record<string, unknown>>) => void;
}): Gate => {
  return async (call) => {
    const name = batonToolName(call.tool);
    const words = call.input["text"] ?? call.input["goal"];
    const text = typeof words === "string" ? words : "";
    const typing = name === "type_text" || name === "press_keys";
    const focus = typing ? await input.focusedWindow() : null;
    const scope: TypingScope | null =
      name === "type_text" && focus !== null
        ? { window: focus.label, field: input.taint.field() }
        : null;
    const judged = judgeToolCall(call, {
      actWithoutAsking: input.actWithoutAsking(),
      tainted: input.taint.on() && !(scope !== null && input.taint.typingAllowedFor(scope)),
      ...(focus === null ? {} : { focusedShell: focus.shell }),
      textIsHis:
        (name === "type_text" ||
          name === "session_send" ||
          name === "job_start" ||
          name === "job_refine") &&
        input.textIsHis(text),
    });
    const action = describeToolCall(call);
    /** A click names the box that typing goes to; Enter or a send ends any yes given to typing. */
    const after = () => {
      if (name === "click" || name === "click_element") input.taint.noteField(fieldOf(call.input));
      if (name === "press_keys" || name === "session_send") input.taint.clearTyping();
    };
    if (judged.verdict === "allow") {
      after();
      input.record({ tool: call.tool, action, outcome: "allowed" });
      if (READS_OUTSIDE.has(name) || READS_OUTSIDE.has(call.tool)) input.taint.mark();
      return { allow: true };
    }
    const prompt = gatePrompt(judged, action);
    const yes = await input.confirm(prompt).catch(() => false);
    input.record({
      tool: call.tool,
      action,
      outcome: yes ? "he said yes" : "he said no",
      ...(judged.risky === true ? { risky: true } : {}),
      why: judged.why,
    });
    if (!yes) return { allow: false, reason: `${judged.why} He said no. Stop and tell him.` };
    after();
    if (scope !== null && judged.risky !== true) input.taint.allowTyping(scope);
    if (READS_OUTSIDE.has(name) || READS_OUTSIDE.has(call.tool)) input.taint.mark();
    return { allow: true };
  };
};
