#!/usr/bin/env node
/* oxlint-disable t3code/namespace-node-imports, t3code/no-low-value-comments -- Baton file predating the rule (D82) */
// Scores whether his vocabulary would have fixed the words he later corrected, on the offline set the
// History builds: every turn he corrected in the field (raw words, what Baton wrote, what he changed
// it to). Word error is measured against his fix, before and after the vocabulary's near-miss
// correction. This is text-level: it does not re-run the recogniser on the kept audio, so it says
// nothing about recognition itself (see docs/baton/VOICE_LEARNING.md).
//   node scripts/baton/clip-eval.mjs <state-dir>
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const base = fileURLToPath(new URL("../../packages/baton-shared/src/", import.meta.url));
const { biasTranscript, parseVocabulary } = await import(`${base}vocabulary.ts`);

const stateDir = process.argv[2];
if (!stateDir) throw new Error("usage: clip-eval.mjs <state-dir>");
const db = new DatabaseSync(join(stateDir, "voice", "history.sqlite"), { readOnly: true });
const rows = db
  .prepare("select raw, cleaned, fixed from turns where corrected = 1 and fixed is not null")
  .all();
let vocabulary = [];
try {
  vocabulary = parseVocabulary(
    JSON.parse(readFileSync(join(stateDir, "voice", "dictionary.json"), "utf8")),
  );
} catch {}

const words = (t) =>
  t
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
/** Word error rate: edit distance over reference length. */
export const wer = (hypothesis, reference) => {
  const h = words(hypothesis);
  const r = words(reference);
  const row = Array.from({ length: r.length + 1 }, (_, j) => j);
  for (let i = 1; i <= h.length; i += 1) {
    let diag = row[0];
    row[0] = i;
    for (let j = 1; j <= r.length; j += 1) {
      const above = row[j];
      row[j] = Math.min(above + 1, row[j - 1] + 1, diag + (h[i - 1] === r[j - 1] ? 0 : 1));
      diag = above;
    }
  }
  return r.length === 0 ? 0 : row[r.length] / r.length;
};

let before = 0;
let after = 0;
for (const row of rows) {
  const written = row.cleaned ?? row.raw;
  before += wer(written, row.fixed);
  after += wer(biasTranscript(written, vocabulary), row.fixed);
}
const n = Math.max(1, rows.length);
console.log(`${rows.length} corrected turns, ${vocabulary.length} vocabulary entries`);
console.log(
  `word error vs his fix: before ${(before / n).toFixed(3)}  after vocabulary ${(after / n).toFixed(3)}`,
);
