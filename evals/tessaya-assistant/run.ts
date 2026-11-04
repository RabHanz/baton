#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalConsole:off
/**
 * The one assistant as it ships: its real prompt, its real tool list on its real MCP server, and the
 * real `claude -p` session, on your own Claude login. Every tool call is recorded and refused, so
 * nothing runs on this machine; the score is which tool it reached for first.
 */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

import { createAssistantAgent } from "../../apps/desktop/src/baton/agent/agentSession.ts";
import { startBatonMcp } from "../../apps/desktop/src/baton/agent/batonMcp.ts";
import { buildBatonTools, type ToolHost } from "../../apps/desktop/src/baton/agent/batonTools.ts";
import { createConversationLog } from "../../apps/desktop/src/baton/conversation/conversationLog.ts";
import { startVisionSession } from "../../apps/desktop/src/baton/screen/claudeVision.ts";
import { assistantCases, type AssistantCase } from "./cases.ts";
import { casePasses, firstTool } from "./grade.ts";

const { values } = NodeUtil.parseArgs({
  options: {
    out: { type: "string" },
    model: { type: "string", default: "claude-opus-5-5" },
    effort: { type: "string", default: "medium" },
    case: { type: "string", multiple: true },
    samples: { type: "string", default: "2" },
    claude: { type: "string", default: "claude" },
  },
});
if (values.out === undefined) throw new Error("Use --out <directory>.");
const out = values.out;
const samples = Number(values.samples);
const cases = assistantCases.filter((c) => values.case === undefined || values.case.includes(c.id));

const REFUSED = "This is a test run and nothing runs. Do not try anything else; reply 'ok'.";
// Every host call fails: the gates refuse first, so this is only a backstop.
const host = new Proxy(
  {},
  {
    get: () => async () => {
      throw new Error(REFUSED);
    },
  },
) as ToolHost;

const sample = async (c: AssistantCase): Promise<ReadonlyArray<string>> => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "tessaya-eval-"));
  const calls: string[] = [];
  const refuse = async () => ({ allow: false as const, reason: REFUSED });
  const mcp = await startBatonMcp({ tools: buildBatonTools(host), gate: refuse });
  const agent = createAssistantAgent({
    start: async (systemPrompt) =>
      startVisionSession({
        claudeBinary: values.claude!,
        model: values.model!,
        effort: values.effort!,
        systemPrompt,
        workDir: dir,
        env: process.env,
        // oxlint-disable-next-line t3code/no-global-process-runtime -- a plain script, not Effect code
        platform: process.platform,
        timeoutMs: 120_000,
        gate: refuse,
        mcp: { url: mcp.url, token: mcp.token },
        onTool: (call) => void calls.push(call.tool),
      }),
    conversation: createConversationLog({ file: NodePath.join(dir, "conversation.ndjson") }),
    clockLine: () => "Wednesday 10:00",
    beginTurn: () => undefined,
  });
  try {
    await agent.say(c.said, { window: "Notepad", session: null });
    return calls;
  } finally {
    agent.dispose();
    await mcp.close();
    NodeFS.rmSync(dir, { recursive: true, force: true });
  }
};

NodeFS.mkdirSync(out, { recursive: true });
const rows: Array<{ id: string; said: string; firsts: string[]; pass: boolean; ms: number[] }> = [];
for (const c of cases) {
  const runs: Array<ReadonlyArray<string>> = [];
  const ms: number[] = [];
  for (let i = 0; i < samples; i += 1) {
    const started = Date.now();
    runs.push(await sample(c).catch(() => ["error"]));
    ms.push(Date.now() - started);
  }
  const row = {
    id: c.id,
    said: c.said,
    firsts: runs.map(firstTool),
    pass: casePasses(c, runs),
    ms,
  };
  rows.push(row);
  console.log(`${row.pass ? "pass" : "FAIL"}  ${c.id}: ${row.firsts.join(", ")}`);
}
NodeFS.writeFileSync(NodePath.join(out, "results.json"), JSON.stringify(rows, null, 2));
const passed = rows.filter((r) => r.pass).length;
const times = rows.flatMap((r) => r.ms).toSorted((a, b) => a - b);
const median = times[Math.floor(times.length / 2)] ?? 0;
NodeFS.writeFileSync(
  NodePath.join(out, "summary.md"),
  [
    `model ${values.model} (effort ${values.effort}), ${samples} samples a case: ${passed} of ${rows.length} pass, median sample ${(median / 1000).toFixed(1)} s`,
    "",
    ...rows.map(
      (r) => `- ${r.pass ? "pass" : "FAIL"} ${r.id} ("${r.said}"): ${r.firsts.join(", ")}`,
    ),
  ].join("\n"),
);
console.log(`${passed} of ${rows.length} pass, median sample ${(median / 1000).toFixed(1)} s`);
