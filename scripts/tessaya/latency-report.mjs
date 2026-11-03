/* oxlint-disable t3code/namespace-node-imports, unicorn/no-useless-spread -- Baton file predating the rule (D82) */
// How fast Baton's first words come (D143). Reads voice-turns.ndjson, prints p50, p90 and the slowest
// turns for the last N. Run: node scripts/tessaya/latency-report.mjs <path to voice-turns.ndjson> [N=50]
// Older turns report `firstSentenceMs` (from the end of the transcript to the first sentence queued);
// agent turns report `firstAudioMs` (from the end of his speech to the first sound). Target: p50 1.5 s, p90 3 s.
import { readFileSync } from "node:fs";

const [file, countArg] = process.argv.slice(2);
if (!file) {
  console.error("usage: node scripts/tessaya/latency-report.mjs <voice-turns.ndjson> [N]");
  process.exit(2);
}
const count = Number(countArg) || 50;
const rows = readFileSync(file, "utf8")
  .split("\n")
  .flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });

const turns = rows
  .filter((r) => r.kind === "turn" || r.kind === "agent_turn")
  .slice(-count)
  .map((r) => ({
    at: r.at,
    route: r.kind === "agent_turn" ? "agent" : r.route,
    ms: r.kind === "agent_turn" ? r.firstAudioMs : r.firstSentenceMs,
    total: r.totalMs,
    tools: r.tools?.length ?? 0,
    said: r.transcript ?? r.said ?? "",
  }))
  .filter((t) => typeof t.ms === "number");

const pct = (sorted, p) =>
  sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
const fmt = (ms) => (ms === undefined ? "n/a" : `${(ms / 1000).toFixed(2)} s`);

if (turns.length === 0) {
  console.log("No turns with a first-word time in the last", count, "lines.");
  process.exit(0);
}
const report = (label, list) => {
  const sorted = list.map((t) => t.ms).toSorted((a, b) => a - b);
  console.log(
    `${label.padEnd(10)} n=${String(list.length).padStart(3)}  p50 ${fmt(pct(sorted, 50))}  p90 ${fmt(pct(sorted, 90))}`,
  );
};
report("all", turns);
for (const route of [...new Set(turns.map((t) => t.route))]) {
  report(
    route,
    turns.filter((t) => t.route === route),
  );
}
console.log("\nslowest five:");
for (const t of turns.toSorted((a, b) => b.ms - a.ms).slice(0, 5)) {
  console.log(
    `  ${fmt(t.ms)}  ${t.route}${t.tools ? ` (${t.tools} tools)` : ""}  ${String(t.said).slice(0, 60)}`,
  );
}
const all = turns.map((t) => t.ms).toSorted((a, b) => a - b);
const ok = pct(all, 50) <= 1500 && pct(all, 90) <= 3000;
console.log(`\ntarget p50 1.5 s, p90 3 s: ${ok ? "MET" : "NOT MET"}`);
