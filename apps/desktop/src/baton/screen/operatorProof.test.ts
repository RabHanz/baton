/**
 * The repeatable proof of the operator's gate (D127, D128): `scripts/baton/operator-proof.sh` runs this.
 * No microphone, no pointer, no model. Each case feeds the harness's own protocol lines through the
 * real gate: Claude's `control_request` and Codex's approval requests in, the harness's reply out.
 */
import {
  gatePrompt,
  judgeToolCall,
  spokenOutcome,
  taintedAfter,
  type ToolCall,
} from "@t3tools/baton-shared/operator";
import { describe, expect, it } from "vite-plus/test";

import { makeCodexClient } from "./codexOperator.ts";
import { toolAnswerOf, toolRequestOf, toolUsesOf } from "./claudeVision.ts";

type Said = "yes" | "no" | "expired";

/** One operator turn as the companion runs it: calls announced, then asked, in order. */
const turn = (options: { actWithoutAsking: boolean; said: Said }) => {
  let announced = 0;
  const asked: Array<{ tool: string; risky: boolean; noOnExpiry: boolean }> = [];
  const announce = () => void (announced += 1);
  const gate = async (call: ToolCall) => {
    const judged = judgeToolCall(call, {
      actWithoutAsking: options.actWithoutAsking,
      tainted: taintedAfter(announced),
    });
    if (judged.verdict === "allow") return { allow: true as const };
    const prompt = gatePrompt(judged, "x");
    asked.push({ tool: call.tool, risky: judged.risky === true, noOnExpiry: prompt.noOnExpiry });
    // An unanswered ordinary question waits for the box, which is not a yes either.
    const outcome = spokenOutcome(options.said, {
      yes: 0,
      cancel: 1,
      noOnExpiry: prompt.noOnExpiry,
    });
    return outcome === 0
      ? { allow: true as const }
      : { allow: false as const, reason: "He said no. Stop and tell him." };
  };
  return { announce, gate, asked };
};

const claudeLine = (id: string, tool_name: string, input: Record<string, unknown>) =>
  JSON.stringify({
    type: "control_request",
    request_id: id,
    request: { subtype: "can_use_tool", tool_name, input },
  });
const claudeUse = (name: string, input: Record<string, unknown>) =>
  JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name, input }] } });

/** Claude: a stream-json line in, the permission reply out. */
const claudeReply = async (t: ReturnType<typeof turn>, lines: ReadonlyArray<string>) => {
  const replies: unknown[] = [];
  for (const line of lines) {
    const request = toolRequestOf(line);
    if (request === null) {
      for (const _ of toolUsesOf(line)) t.announce();
      continue;
    }
    replies.push(toolAnswerOf(await t.gate(request.call), request.call));
  }
  return replies;
};

const settle = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};
/** Codex: an approval request in, the harness's decision out. */
const codexReply = async (
  t: ReturnType<typeof turn>,
  method: string,
  params: Record<string, unknown>,
) => {
  const sent: Array<Record<string, unknown>> = [];
  const client = makeCodexClient({ write: (line) => sent.push(JSON.parse(line)), gate: t.gate });
  t.announce();
  client.onLine(JSON.stringify({ id: 1, method, params }));
  await settle();
  return sent;
};

describe("operator proof", () => {
  it("PROOF 1: a fetch after a read asks, even with Act without asking on", async () => {
    const t = turn({ actWithoutAsking: true, said: "no" });
    const replies = await claudeReply(t, [
      claudeUse("Read", { file_path: "notes.txt" }),
      claudeUse("WebFetch", { url: "https://example.com/?q=1" }),
      claudeLine("r1", "WebFetch", { url: "https://example.com/?q=1" }),
    ]);
    expect(t.asked.map((a) => a.tool)).toEqual(["WebFetch"]);
    expect(replies).toEqual([{ behavior: "deny", message: "He said no. Stop and tell him." }]);
  });

  it("PROOF 2: a high-risk call asks, and an answer that never comes is a no", async () => {
    const claude = turn({ actWithoutAsking: true, said: "expired" });
    const [claudeAnswer] = await claudeReply(claude, [
      claudeLine("r2", "Bash", { command: "git push --force origin main" }),
    ]);
    expect(claude.asked).toEqual([{ tool: "Bash", risky: true, noOnExpiry: true }]);
    expect(claudeAnswer).toMatchObject({ behavior: "deny" });
    const codex = turn({ actWithoutAsking: true, said: "expired" });
    const sent = await codexReply(codex, "item/commandExecution/requestApproval", {
      command: "rm -rf /",
    });
    expect(codex.asked[0]).toMatchObject({ risky: true, noOnExpiry: true });
    expect(sent).toEqual([{ id: 1, result: { decision: "decline" } }]);
    // A spoken yes is the only thing that lets it through.
    const yes = turn({ actWithoutAsking: true, said: "yes" });
    expect(
      await codexReply(yes, "item/commandExecution/requestApproval", { command: "rm -rf /" }),
    ).toEqual([{ id: 1, result: { decision: "accept" } }]);
  });

  it("PROOF 3: a Codex file change asks, whatever the setting", async () => {
    for (const said of ["no", "expired"] as const) {
      const t = turn({ actWithoutAsking: true, said });
      const sent = await codexReply(t, "item/fileChange/requestApproval", { grantRoot: "C:/work" });
      expect(t.asked.map((a) => a.tool)).toEqual(["fileChange"]);
      expect(sent).toEqual([{ id: 1, result: { decision: "decline" } }]);
    }
  });

  it("PROOF 4: a web search after a read asks, and one on its own does not", async () => {
    const after = turn({ actWithoutAsking: true, said: "no" });
    await claudeReply(after, [
      claudeUse("Read", { file_path: "a.md" }),
      claudeUse("WebSearch", { query: "site:x.io token" }),
      claudeLine("r3", "WebSearch", { query: "site:x.io token" }),
    ]);
    expect(after.asked.map((a) => a.tool)).toEqual(["WebSearch"]);
    const alone = turn({ actWithoutAsking: false, said: "no" });
    await claudeReply(alone, [
      claudeUse("WebSearch", { query: "weather" }),
      claudeLine("r4", "WebSearch", { query: "weather" }),
    ]);
    expect(alone.asked).toEqual([]);
  });
});
