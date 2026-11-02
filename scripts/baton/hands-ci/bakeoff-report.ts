// @effect-diagnostics nodeBuiltinImport:off
// Folds the bake-off's results.json files (one directory per variant and repetition) into one table.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

interface Row {
  result: string;
  seconds: number;
  steps: Array<{ kind: string; ms: number }>;
  turns: number;
  treeBytes: number;
}

const root = process.argv[2] ?? "bakeoff";
const byVariant = new Map<string, Row[][]>();
for (const dir of NodeFS.readdirSync(root).sort()) {
  const file = NodePath.join(root, dir, "results.json");
  if (!NodeFS.existsSync(file)) continue;
  const variant = dir.replace(/^hands-/, "").replace(/-\d+$/, "");
  byVariant.set(variant, [
    ...(byVariant.get(variant) ?? []),
    JSON.parse(NodeFS.readFileSync(file, "utf8")) as Row[],
  ]);
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
};
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

const lines = [
  "| Variant | Runs | Tasks passed | Tool calls/task | Model turns/task | p50 call ms | p90 call ms | Seconds/task | Tree bytes/task |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
];
for (const [variant, runs] of byVariant) {
  const rows = runs.flat();
  const calls = rows.flatMap((r) =>
    r.steps.filter((s) => (s.kind === "see" || s.kind === "act") && s.ms > 0),
  );
  const n = rows.length;
  const f = (x: number) => (Math.round(x * 10) / 10).toString();
  lines.push(
    `| ${variant} | ${runs.length} | ${rows.filter((r) => r.result === "pass").length}/${n} | ${f(calls.length / n)} | ${f(sum(rows.map((r) => r.turns)) / n)} | ${pct(
      calls.map((c) => c.ms),
      0.5,
    )} | ${pct(
      calls.map((c) => c.ms),
      0.9,
    )} | ${f(sum(rows.map((r) => r.seconds)) / n)} | ${Math.round(sum(rows.map((r) => r.treeBytes)) / n)} |`,
  );
}
console.log(lines.join("\n"));
