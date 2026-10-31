// @effect-diagnostics globalDate:off nodeBuiltinImport:off
/**
 * Runs the real clean-up on the laptop, on his own `claude`: the written cases, then his stored
 * dictation for delay and how often the model is needed. Bundled by bundle-cleanup.sh; see VOICE.md.
 *   node cleanup-lab.mjs cases <out.jsonl> | clips <lab> <out.json> [count]
 * `clips` reports aggregates only: nothing he said leaves the laptop.
 */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  localClean,
  needsModel,
  type DictionaryEntry,
} from "../../../packages/baton-shared/src/dictationCleanup.ts";
import {
  importWisprDictionary,
  makeRewriter,
  readDictionary,
} from "../../../apps/desktop/src/baton/voice/dictationRewriter.ts";
import { ADVERSARIAL_CASES, DEFAULT_CASES, MODE_CASES, type CleanupCase } from "./cleanup-cases.ts";

const state = NodePath.join(NodeOS.tmpdir(), "baton-cleanup-lab");
const dictionary: ReadonlyArray<DictionaryEntry> =
  (await readDictionary(state)) ??
  (await importWisprDictionary({ stateDir: state, appData: process.env["APPDATA"] }));
const rewriter = (always: boolean, limitMs: number) =>
  makeRewriter({
    claudeBinary: "claude",
    model: process.env["BATON_CLEANUP_MODEL"] ?? "haiku",
    workDir: NodePath.join(state, "work"),
    env: process.env,
    platform: process.platform,
    dictionary: () => dictionary,
    limitMs,
    always,
  });

const sorted = (values: ReadonlyArray<number>) => [...values].sort((a, b) => a - b);
const median = (values: ReadonlyArray<number>) => sorted(values)[Math.floor(values.length / 2)] ?? 0;
const p95 = (values: ReadonlyArray<number>) => sorted(values)[Math.floor(values.length * 0.95)] ?? 0;

const cases = async (out: string) => {
  const r = rewriter(true, 30_000);
  r.warm();
  await new Promise((resolve) => setTimeout(resolve, 8_000));
  const lines: string[] = [];
  const run = async (group: string, list: ReadonlyArray<CleanupCase & { mode?: string }>) => {
    let failed = 0;
    for (const item of list) {
      const mode = (item.mode ?? "default") as "default";
      const result = await r.clean({ raw: item.raw, mode, level: "claude" });
      const lost = item.keep.filter((k) => !result.text.includes(k));
      const stayed = (item.gone ?? []).filter((g) => result.text.includes(g));
      const pass = lost.length === 0 && stayed.length === 0;
      failed += pass ? 0 : 1;
      lines.push(
        JSON.stringify({
          group,
          mode,
          pass,
          stage: result.stage,
          why: result.why,
          ms: result.ms,
          lost,
          stayed,
          raw: item.raw,
          text: result.text,
        }),
      );
    }
    console.log(`${group}: ${list.length - failed} of ${list.length} kept everything required`);
  };
  await run("default", DEFAULT_CASES);
  await run("adversarial", ADVERSARIAL_CASES);
  await run("modes", MODE_CASES);
  NodeFS.writeFileSync(out, `${lines.join("\n")}\n`);
  r.dispose();
};

const clips = async (lab: string, out: string, count: number) => {
  const rows = NodeFS.readFileSync(NodePath.join(lab, "clips.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { asr: string | null });
  const usable = rows.flatMap((c) => (c.asr === null || c.asr.length === 0 ? [] : [c.asr]));
  const started = process.hrtime.bigint();
  const locals = usable.map((asr) => localClean(asr, "default", dictionary));
  const localMs = Number(process.hrtime.bigint() - started) / 1e6 / usable.length;
  const flagged = usable.filter((_, i) => needsModel(locals[i] as string, "default"));
  const r = rewriter(false, 3_000);
  r.warm();
  await new Promise((resolve) => setTimeout(resolve, 8_000));
  const stages: Record<string, number> = {};
  const why: Record<string, number> = {};
  const ms: number[] = [];
  for (const raw of flagged.slice(0, count)) {
    const result = await r.clean({ raw, mode: "default", level: "claude" });
    stages[result.stage] = (stages[result.stage] ?? 0) + 1;
    if (result.why !== undefined) {
      const key = result.why.split(" ").slice(0, 2).join(" ");
      why[key] = (why[key] ?? 0) + 1;
    }
    ms.push(result.ms);
  }
  r.dispose();
  const report = {
    clips: usable.length,
    dictionaryTerms: dictionary.length,
    localMsPerClip: localMs,
    needModel: flagged.length,
    modelRuns: ms.length,
    stages,
    refusedBecause: why,
    medianMs: median(ms),
    p95Ms: p95(ms),
  };
  NodeFS.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
};

const [, , step, a, b, c] = process.argv;
if (step === "cases") await cases(a as string);
else await clips(a as string, b as string, Number(c ?? 60));
process.exit(0);
