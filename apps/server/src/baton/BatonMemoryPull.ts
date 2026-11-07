// @effect-diagnostics nodeBuiltinImport:off
/**
 * Cross-venture learnings (D150): on a schedule he switches on, ask the history index for learnings and
 * propose them as memory, held for his yes. Each proposal is a short quote with its session id; no
 * transcript is copied and nothing is written to the index. Without the index it says so and does nothing.
 */
import * as NodeCrypto from "node:crypto";

import * as NodePath from "node:path";

import {
  askHistory,
  keepHistory,
  NOT_HERE,
  parseLearnings,
  type HistoryAnswer,
} from "@t3tools/baton-shared/historyIndex";
import { redactSecretLines, sharesPrivateText } from "@t3tools/baton-shared/memory";
import { DEFAULT_OS_PACK, isWalled } from "@t3tools/baton-shared/osPack";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as ServerConfig from "../config.ts";
import { BatonMemoryService, MemoryPrivateTexts, MemoryViewer } from "./BatonMemoryService.ts";
import { BatonMemorySync } from "./BatonMemorySync.ts";
import { readPack } from "./OperatingSystemPack.ts";

export const PULL_FLAG = "learnings-pull";
/** What to ask the index for; the index's own tags decide what a venture is. */
const QUERIES = ["learned", "lesson", "what worked", "what failed"];

type Env = Readonly<Record<string, string | undefined>>;
type Runner = Parameters<typeof askHistory>[2];

export const NO_SERVER =
  "No server with the history index could be reached, so past work cannot be searched right now. The index lives on one of his servers; pair it with this one for memory sync, or try again when it is up.";

export const TOO_SLOW =
  "The history search did not answer in time, so past work could not be searched.";
/** Under the desktop's 20 s wait for its own server. */
const DEADLINE = "12 seconds";

/** What this server's own index may give this caller: no walled project's hits or private pack text unless it is his own view, and never a secret. */
const answerFromHere = Effect.fn("BatonMemoryPull.answerFromHere")(function* (
  text: string,
  admin: boolean,
) {
  if (admin) return redactSecretLines(text);
  const config = yield* Effect.serviceOption(ServerConfig.ServerConfig);
  const pack = Option.isNone(config)
    ? DEFAULT_OS_PACK
    : readPack(NodePath.dirname(config.value.dbPath));
  const privateTexts = (yield* MemoryPrivateTexts)();
  return redactSecretLines(
    keepHistory(
      text,
      (venture, hit) =>
        (venture !== null && isWalled(pack, venture)) || sharesPrivateText(hit, privateTexts),
    ),
  );
});

const findHistory = Effect.fn("BatonMemoryPull.find")(function* (
  ask: { readonly query?: string; readonly session?: string; readonly admin?: boolean },
  env: Env,
  run: Runner | undefined,
) {
  const { admin, ...words } = ask;
  const viewer = yield* MemoryViewer;
  const here = yield* Effect.promise(() => askHistory(env, words, run));
  if (here.ok)
    return {
      ok: true,
      text: yield* answerFromHere(here.text, admin === true && viewer === "desktop"),
    } satisfies HistoryAnswer;
  // A peer's ask is answered from this server's own index only, so two servers never ask each other in a loop.
  if (here.why !== NOT_HERE || viewer === "server") return here;
  const there = yield* (yield* BatonMemorySync).history(words);
  return Option.match(there, {
    onNone: (): HistoryAnswer => ({ ok: false, why: NO_SERVER }),
    onSome: (answer): HistoryAnswer =>
      answer.found ? { ok: true, text: answer.text } : { ok: false, why: answer.text },
  });
});

/** This server's own index (D5: one server holds it), else the first paired peer whose index finds it, within one deadline. */
export const searchHistory = Effect.fn("BatonMemoryPull.search")(function* (
  ask: { readonly query?: string; readonly session?: string; readonly admin?: boolean },
  env: Env = process.env,
  run?: Runner,
) {
  const answer = yield* findHistory(ask, env, run).pipe(Effect.timeoutOption(DEADLINE));
  return Option.getOrElse(answer, (): HistoryAnswer => ({ ok: false, why: TOO_SLOW }));
});

export const pullLearnings = Effect.fn("BatonMemoryPull.pull")(function* (
  env: Env = process.env,
  run?: Runner,
) {
  const memory = yield* BatonMemoryService;
  let found = 0;
  let held = 0;
  let why: string | null = null;
  for (const query of QUERIES) {
    const answer = yield* searchHistory({ query }, env, run);
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
  if (action === "enable" || action === "disable")
    yield* memory.setFlag(PULL_FLAG, action === "enable");
  const enabled = yield* memory.flag(PULL_FLAG);
  if (action !== "run") {
    return {
      enabled,
      found: 0,
      held: 0,
      message: enabled ? "Pulling learnings daily." : "Not pulling learnings.",
    };
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
