// @effect-diagnostics nodeBuiltinImport:off
/**
 * Cross-venture learnings (D150): on a schedule he switches on, ask the history index for learnings and
 * propose them as memory, held for his yes. Each proposal is a short quote with its session id; no
 * transcript is copied and nothing is written to the index. Without the index it says so and does nothing.
 */
import * as NodeCrypto from "node:crypto";

import { askHistory, parseLearnings } from "@t3tools/baton-shared/historyIndex";
import * as Effect from "effect/Effect";

import { BatonMemoryService } from "./BatonMemoryService.ts";

export const PULL_FLAG = "learnings-pull";
/** What to ask the index for; the index's own tags decide what a venture is. */
const QUERIES = ["learned", "lesson", "what worked", "what failed"];

type Env = Readonly<Record<string, string | undefined>>;
type Runner = Parameters<typeof askHistory>[2];

export const pullLearnings = Effect.fn("BatonMemoryPull.pull")(function* (
  env: Env = process.env,
  run?: Runner,
) {
  const memory = yield* BatonMemoryService;
  let found = 0;
  let held = 0;
  let why: string | null = null;
  for (const query of QUERIES) {
    const answer = yield* Effect.promise(() => askHistory(env, { query }, run));
    if (!answer.ok) {
      why = answer.why;
      break;
    }
    for (const hit of parseLearnings(answer.text)) {
      const key = `pull:${hit.sessionId}:${NodeCrypto.createHash("sha1").update(hit.quote).digest("hex")}`;
      if (!(yield* memory.noteOnce(key, "1"))) continue;
      found++;
      const item = yield* memory
        .add({
          kind: "learning",
          text: `${hit.quote} (session ${hit.sessionId})`.slice(0, 500),
          source: "import",
          sourceRef: `session:${hit.sessionId}`,
          scope: hit.venture === null ? "global" : "project",
          scopeRef: hit.venture,
          // From the index, not from him: nothing becomes memory until he says yes.
          tainted: true,
        })
        .pipe(Effect.orElseSucceed(() => null));
      if (item?.proposed === true) held++;
    }
  }
  return { found, held, why };
});

export const pullAction = Effect.fn("BatonMemoryPull.action")(function* (
  action: "status" | "enable" | "disable" | "run",
) {
  const memory = yield* BatonMemoryService;
  if (action === "enable" || action === "disable") yield* memory.setFlag(PULL_FLAG, action === "enable");
  const enabled = yield* memory.flag(PULL_FLAG);
  if (action !== "run") {
    return { enabled, found: 0, held: 0, message: enabled ? "Pulling learnings daily." : "Not pulling learnings." };
  }
  const out = yield* pullLearnings();
  return {
    enabled,
    found: out.found,
    held: out.held,
    message: out.why ?? `Found ${out.found} new, ${out.held} waiting for your yes in Memory.`,
  };
});

/** The daily pass, when he has switched it on. */
export const pullIfEnabled = Effect.gen(function* () {
  const memory = yield* BatonMemoryService;
  if (yield* memory.flag(PULL_FLAG)) yield* pullLearnings();
});
