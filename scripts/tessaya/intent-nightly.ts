// @effect-diagnostics globalConsole:off
/* oxlint-disable t3code/no-global-process-runtime -- Baton file predating the rule (D82) */
// @effect-diagnostics nodeBuiltinImport:off globalDate:off
/**
 * Runs the labelled sentences (packages/baton-voice/test/fixtures/utterances.json) through the real
 * router on a real `claude` login and reports accuracy, with every miss listed. Nightly in CI when a
 * login secret exists (.github/workflows/baton-intent-nightly.yml); by hand:
 *   node scripts/tessaya/intent-nightly.ts --claude claude [--min 0.85]
 */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { startVisionSession } from "../../apps/desktop/src/baton/screen/claudeVision.ts";
import { BRAIN_ROUTER_PROMPT, decide } from "../../packages/baton-shared/src/brain.ts";
import { resolveBatonIntent } from "../../packages/baton-shared/src/intentParser.ts";
import { fleet } from "../../packages/baton-voice/test/grammarClient.ts";

const flag = (name: string, fallback: string): string => {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : process.argv[at + 1]!;
};

const rows = (
  JSON.parse(
    NodeFS.readFileSync(
      new URL("../../packages/baton-voice/test/fixtures/utterances.json", import.meta.url),
      "utf8",
    ),
  ) as ReadonlyArray<{ say: string; tag: string; assistant: string | null }>
).filter((r) => r.assistant !== null);

const workDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "baton-intent-"));
const base = {
  claudeBinary: flag("--claude", "claude"),
  workDir,
  env: process.env,
  platform: process.platform,
};
const start = () =>
  startVisionSession({
    ...base,
    model: "haiku",
    systemPrompt: BRAIN_ROUTER_PROMPT,
    timeoutMs: 30_000,
  });
let router = start();
let turns = 0;

const misses: string[] = [];
const byTag = new Map<string, { ok: number; all: number }>();
for (const r of rows) {
  const decision = await decide(
    r.say,
    { running: null, direct: false, recent: [] },
    {
      ask: (turn) => {
        if (turns >= 6) {
          router.dispose();
          router = start();
          turns = 0;
        }
        turns += 1;
        return router.ask([{ type: "text", text: turn }]);
      },
      grammarPlaces: async (said) => resolveBatonIntent(said, fleet).outcome === "resolved",
    },
  );
  const ok = decision.route === r.assistant;
  const t = byTag.get(r.tag) ?? { ok: 0, all: 0 };
  byTag.set(r.tag, { ok: t.ok + (ok ? 1 : 0), all: t.all + 1 });
  if (!ok)
    misses.push(
      `"${r.say}" (${r.tag}): expected ${r.assistant}, got ${decision.route}/${decision.source}`,
    );
}
router.dispose();
NodeFS.rmSync(workDir, { recursive: true, force: true, maxRetries: 3 });

const good = rows.length - misses.length;
const accuracy = good / rows.length;
const report = [
  `## Intent accuracy: ${good} of ${rows.length} (${(accuracy * 100).toFixed(1)}%)`,
  "",
  ...[...byTag].map(([tag, v]) => `- ${tag}: ${v.ok} of ${v.all}`),
  "",
  misses.length === 0 ? "No misses." : `### Misses\n${misses.map((m) => `- ${m}`).join("\n")}`,
].join("\n");
console.log(report);
const summary = process.env["GITHUB_STEP_SUMMARY"];
if (summary !== undefined) NodeFS.appendFileSync(summary, `${report}\n`);
if (accuracy < Number(flag("--min", "0.85"))) process.exit(1);
