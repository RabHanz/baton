// Summarise span durations from a T3 server trace, slowest names first, for one or more files.
//   node scripts/baton/span-times.mjs <server.trace.ndjson>... [--match <regex>] [--top N]
import * as NodeFS from "node:fs";

const args = process.argv.slice(2);
const files = [];
let match = /./;
let top = 25;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--match") match = new RegExp(args[++i]);
  else if (args[i] === "--top") top = Number(args[++i]);
  else files.push(args[i]);
}
const byName = new Map();
for (const file of files) {
  for (const line of NodeFS.readFileSync(file, "utf8").split("\n")) {
    if (!line.includes('"durationMs"')) continue;
    let span;
    try {
      span = JSON.parse(line);
    } catch {
      continue;
    }
    if (!match.test(span.name)) continue;
    const entry = byName.get(span.name) ?? [];
    entry.push(span.durationMs);
    byName.set(span.name, entry);
  }
}
const rows = [...byName].map(([name, ds]) => {
  ds.sort((a, b) => a - b);
  const p = (q) => ds[Math.min(ds.length - 1, Math.floor(q * ds.length))];
  return { name, n: ds.length, p50: p(0.5), p95: p(0.95), max: ds.at(-1) };
});
rows.sort((a, b) => b.p95 - a.p95);
for (const r of rows.slice(0, top))
  console.log(
    `${r.p95.toFixed(0).padStart(7)} p95  ${r.p50.toFixed(0).padStart(6)} p50  ${r.max.toFixed(0).padStart(7)} max  ${String(r.n).padStart(5)}x  ${r.name}`,
  );
