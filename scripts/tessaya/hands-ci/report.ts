// @effect-diagnostics nodeBuiltinImport:off globalConsole:off
// Turns results.json into the table in docs/baton/research/hands-loop-tasks.md.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const dir = process.argv[2] ?? "hands-out";
const results = JSON.parse(
  NodeFS.readFileSync(NodePath.join(dir, "results.json"), "utf8"),
) as Array<{
  id: string;
  goal: string;
  result: string;
  seconds: number;
  evidence: string;
  cause: string;
  steps: Array<{ kind: string; text: string; ms: number }>;
}>;
const cell = (s: string) => s.replaceAll("|", "\\|").replaceAll("\n", " ");
const passed = results.filter((r) => r.result === "pass").length;
const lines = [
  `Run on a Windows desktop, ${results.length} tasks, ${passed} passed.`,
  "",
  "| Task | Result | Steps | Seconds | Evidence or failure cause |",
  "| --- | --- | --- | --- | --- |",
  ...results.map(
    (r) =>
      `| ${cell(r.goal)} | ${r.result} | ${r.steps.length} | ${r.seconds} | ${cell(r.result === "pass" ? r.evidence : r.cause)} |`,
  ),
  "",
  "## Step logs",
  "",
  ...results.flatMap((r) => [
    `### ${r.id}: ${r.result}`,
    "",
    ...r.steps.map((s) => `- ${s.kind}: ${cell(s.text)}${s.ms > 0 ? ` (${s.ms} ms)` : ""}`),
    "",
  ]),
];
NodeFS.writeFileSync(NodePath.join(dir, "hands-loop-tasks.md"), lines.join("\n"));
console.log(lines.slice(0, results.length + 4).join("\n"));
