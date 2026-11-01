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
export interface TurnTaint {
  readonly mark: () => void;
  readonly on: () => boolean;
  readonly reset: () => void;
}

export const createTaint = (): TurnTaint => {
  let tainted = false;
  return {
    mark: () => void (tainted = true),
    on: () => tainted,
    reset: () => void (tainted = false),
  };
};

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
  /** Does the window with the keyboard look like a command line, or can it not be told? */
  readonly shellFocused: () => Promise<boolean>;
  readonly confirm: (prompt: ConfirmPrompt) => Promise<boolean>;
  readonly record: (entry: Readonly<Record<string, unknown>>) => void;
}): Gate => {
  return async (call) => {
    const name = batonToolName(call.tool);
    const text = typeof call.input["text"] === "string" ? call.input["text"] : "";
    const typing = name === "type_text" || name === "press_keys";
    const judged = judgeToolCall(call, {
      actWithoutAsking: input.actWithoutAsking(),
      tainted: input.taint.on(),
      ...(typing ? { focusedShell: await input.shellFocused() } : {}),
      textIsHis: (name === "type_text" || name === "session_send") && input.textIsHis(text),
    });
    const action = describeToolCall(call);
    if (judged.verdict === "allow") {
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
    if (READS_OUTSIDE.has(name) || READS_OUTSIDE.has(call.tool)) input.taint.mark();
    return { allow: true };
  };
};
