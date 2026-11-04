#!/usr/bin/env node
/* oxlint-disable oxc/no-accumulating-spread, t3code/namespace-node-imports, t3code/no-low-value-comments, unicorn/no-useless-spread -- Baton file predating the rule (D82) */
// Scores Baton's dictation clean-up against real messages. The corpus (his own words) stays OUT of
// the repo: pass its path. Each message is degraded the way a recogniser's raw output reads
// (no punctuation or capitals, fillers, a false start, a "scratch that" self-correction), cleaned
// by Baton's local pass and by local-then-Claude, and scored 0..1 per criterion against the message.
//   node scripts/tessaya/cleanup-eval.mjs <corpus.json> [--claude] [--punctuated] [--out results.json] [--limit N]
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const base = fileURLToPath(new URL("../../packages/baton-shared/src/", import.meta.url));
const { cleanDictation, rewriteMessage, rewriteSystemPrompt } = await import(
  `${base}dictationCleanup.ts`
);

const args = process.argv.slice(2);
const corpus = JSON.parse(readFileSync(args[0], "utf8"));
const flag = (name) => args.indexOf(name);
const useClaude = flag("--claude") >= 0;
const limit = flag("--limit") >= 0 ? Number(args[flag("--limit") + 1]) : corpus.length;
const out = flag("--out") >= 0 ? args[flag("--out") + 1] : null;
// Parakeet punctuates and capitalises: --punctuated keeps that, so the local gate sees what it sees in use.
const punctuated = flag("--punctuated") >= 0;

const words = (text) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'’\s-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
const FILLERS = ["um", "uh", "you know", "er"];

/** What a recogniser would hand over: deterministic, so runs compare. */
export const degrade = (text, index) => {
  const w = punctuated ? text.split(/\s+/).filter(Boolean) : words(text);
  const out = [];
  w.forEach((word, i) => {
    if (i > 0 && i % 11 === 0) out.push(FILLERS[(i + index) % FILLERS.length]);
    out.push(word);
  });
  let bogus = null;
  if (index % 3 === 0 && w.length > 12) {
    const at = Math.floor(w.length / 2);
    // A phrase that is not in the message, so finding it in the output proves the correction was missed.
    bogus =
      ["on thursday afternoon", "the blue folder", "by next tuesday"].find(
        (p) => !text.toLowerCase().includes(p),
      ) ?? null;
    const pos = out.indexOf(w[at]);
    if (pos > 0) out.splice(pos, 0, bogus, "scratch that");
    else bogus = null;
  }
  if (index % 2 === 0) out.unshift(w[0]);
  return { raw: out.join(" "), bogus };
};

const lcs = (a, b) => {
  const row = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    let diag = 0;
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j];
      row[j] = a[i - 1] === b[j - 1] ? diag + 1 : Math.max(row[j], row[j - 1]);
      diag = above;
    }
  }
  return row[b.length];
};

const score = (gold, input, output, bogus) => {
  const g = words(gold);
  const o = words(output);
  const known = new Set([...g, ...words(input)]);
  const goldHasEnd = /[.!?]["')]*$/.test(gold.trim());
  const marks = [
    /^\p{Lu}/u.test(output.trim()) || !/^\p{Lu}/u.test(gold.trim()),
    !goldHasEnd || /[.!?]["')]*$/.test(output.trim()),
    !/(^|\s)i(\s|'|$)/.test(output),
  ];
  return {
    wording: lcs(g, o) / g.length,
    filler:
      /\b(um|uh|er|you know)\b/i.test(output) && !/\b(um|uh|er|you know)\b/i.test(gold) ? 0 : 1,
    selfcorrect:
      /scratch that/i.test(output) || (bogus !== null && output.toLowerCase().includes(bogus))
        ? 0
        : 1,
    punct: marks.filter(Boolean).length / marks.length,
    invented: o.filter((word) => !known.has(word)).length <= 1 ? 1 : 0,
  };
};

const askClaude = async (text, mode) => {
  const run = spawnSync(
    "claude",
    [
      "-p",
      "--model",
      "haiku",
      "--tools",
      "",
      "--no-session-persistence",
      "--system-prompt",
      rewriteSystemPrompt([]),
      rewriteMessage(text, mode),
    ],
    { encoding: "utf8", timeout: 60_000 },
  );
  if (run.status !== 0) throw new Error(run.stderr?.slice(0, 200) || "claude failed");
  return run.stdout.trim();
};

const rows = [];
for (const [index, gold] of corpus.slice(0, limit).entries()) {
  const { raw, bogus } = degrade(gold, index);
  const levels = { local: "local", ...(useClaude ? { claude: "claude" } : {}) };
  for (const [name, level] of Object.entries(levels)) {
    const cleaned = await cleanDictation({
      raw,
      mode: "default",
      level,
      dictionary: [],
      ask: askClaude,
    });
    rows.push({
      index,
      level: name,
      stage: cleaned.stage,
      why: cleaned.why ?? null,
      ...score(gold, raw, cleaned.text, bogus),
      text: cleaned.text,
    });
  }
}
const metrics = ["wording", "filler", "selfcorrect", "punct", "invented"];
const mean = (list, key) =>
  (list.reduce((sum, row) => sum + row[key], 0) / Math.max(1, list.length)).toFixed(2);
console.log(
  `| level | n | ${metrics.join(" | ")} |\n|---|---|${metrics.map(() => "---").join("|")}|`,
);
for (const level of [...new Set(rows.map((row) => row.level))]) {
  const set = rows.filter((row) => row.level === level);
  console.log(`| ${level} | ${set.length} | ${metrics.map((key) => mean(set, key)).join(" | ")} |`);
}
const stages = rows.reduce(
  (all, row) => ({
    ...all,
    [`${row.level}:${row.stage}`]: (all[`${row.level}:${row.stage}`] ?? 0) + 1,
  }),
  {},
);
console.log("\nstages", JSON.stringify(stages));
if (out !== null) writeFileSync(out, JSON.stringify(rows, null, 1));
