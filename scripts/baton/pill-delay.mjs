#!/usr/bin/env node
/* oxlint-disable t3code/namespace-node-imports -- Baton file predating the rule (D82) */
// Measures how long the pill stays after he stops speaking: speech_end -> pill_hidden, from the
// voice turn log (voice-turns.ndjson). Usage: node scripts/baton/pill-delay.mjs [log-file]
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const file = process.argv[2] ?? join(homedir(), ".t3", "userdata", "logs", "voice-turns.ndjson");
const events = readFileSync(file, "utf8")
  .split("\n")
  .flatMap((line) => {
    try {
      const e = JSON.parse(line);
      return e.at && e.kind ? [{ ...e, t: Date.parse(e.at) }] : [];
    } catch {
      return [];
    }
  });
const delays = [];
let endedAt = null;
for (const e of events) {
  if (e.kind === "speech_end") endedAt = e.t;
  else if (e.kind === "pill_hidden" && endedAt !== null) {
    delays.push(e.t - endedAt);
    endedAt = null;
  }
}
if (delays.length === 0) {
  console.log("no speech_end -> pill_hidden pairs in", file);
  process.exit(1);
}
delays.sort((a, b) => a - b);
const at = (p) => delays[Math.min(delays.length - 1, Math.floor(p * delays.length))];
console.log(
  `${delays.length} turns  p50 ${at(0.5)} ms  p95 ${at(0.95)} ms  max ${delays.at(-1)} ms`,
);
