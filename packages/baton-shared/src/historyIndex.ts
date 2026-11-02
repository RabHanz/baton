// @effect-diagnostics nodeBuiltinImport:off
/**
 * Asking the history index (D150, cross-venture learnings): the one searchable record of past work lives
 * elsewhere, and this only reads it through the script the maintainer's box provides. Tessaya keeps no second
 * history store, never copies a transcript, and never writes to the index. Node-only.
 */
import * as NodeChildProcess from "node:child_process";

export const HISTORY_ENV = "BATON_HISTORY_SEARCH";
const OUTPUT_MAX = 6_000;
const SESSION = /^[0-9a-fA-F][0-9a-fA-F-]{5,63}$/;
const TIMEOUT_MS = 15_000;

export type HistoryAnswer =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly why: string };

export const NOT_HERE =
  "The history index is not set up on this computer, so there is nothing to search. (Set BATON_HISTORY_SEARCH to the history search script.)";

/** Runs `script words...` or `script show <session>` with no shell, a time limit and a size limit. */
export const askHistory = (
  env: Readonly<Record<string, string | undefined>>,
  ask: { readonly query?: string; readonly session?: string },
  run: (file: string, args: ReadonlyArray<string>) => Promise<string> = (file, args) =>
    new Promise((resolve, reject) =>
      NodeChildProcess.execFile(
        "bash",
        [file, ...args],
        { timeout: TIMEOUT_MS, maxBuffer: OUTPUT_MAX * 8, windowsHide: true },
        (error, stdout) => (error === null ? resolve(stdout) : reject(error)),
      ),
    ),
): Promise<HistoryAnswer> => {
  const script = env[HISTORY_ENV];
  if (script === undefined || script.trim() === "") return Promise.resolve({ ok: false, why: NOT_HERE });
  let args: string[];
  if (ask.session !== undefined) {
    if (!SESSION.test(ask.session)) return Promise.resolve({ ok: false, why: "That is not a session id." });
    args = ["show", ask.session];
  } else {
    const words = (ask.query ?? "").split(/\s+/).filter((w) => w !== "" && !w.startsWith("-")).slice(0, 12);
    if (words.length === 0) return Promise.resolve({ ok: false, why: "Say what to search for." });
    args = words;
  }
  return run(script, args).then(
    (out) => ({ ok: true as const, text: out.slice(0, OUTPUT_MAX) }),
    () => ({ ok: false as const, why: "The history search did not answer." }),
  );
};

export interface FoundLearning {
  readonly sessionId: string;
  /** A short quote from the hit, never a transcript. */
  readonly quote: string;
  readonly venture: string | null;
}

const ID = /\b([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|[0-9a-f]{8})\b/i;
const QUOTE_MAX = 300;

/** One finding per output line that names a session; the line is the quote. Tolerant, because the format is the index's. */
export const parseLearnings = (output: string, max = 20): ReadonlyArray<FoundLearning> => {
  const seen = new Set<string>();
  const out: FoundLearning[] = [];
  for (const line of output.split(/\r?\n/)) {
    const id = ID.exec(line)?.[1];
    if (id === undefined) continue;
    const quote = line.replace(ID, "").replace(/\s+/g, " ").replace(/^[\s:|\-–]+/, "").trim().slice(0, QUOTE_MAX);
    if (quote.length < 12) continue;
    const key = `${id}|${quote}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const venture = /venture[:=\s]+([A-Za-z0-9_-]{2,40})/i.exec(line)?.[1]?.toLowerCase() ?? null;
    out.push({ sessionId: id.toLowerCase(), quote, venture });
    if (out.length >= max) break;
  }
  return out;
};
