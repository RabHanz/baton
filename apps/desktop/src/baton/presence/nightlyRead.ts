// @effect-diagnostics nodeBuiltinImport:off
/**
 * The last nightly self-check, read from the status branch with the GitHub command line when it is there. Read only,
 * cached, and never an error: no `gh`, no network or no file all mean "unknown".
 */
import * as NodeChildProcess from "node:child_process";

import { parseNightly, type NightlyStatus } from "@t3tools/baton-shared/nightly";

export type RunGh = (args: ReadonlyArray<string>) => Promise<string>;

const runGh: RunGh = (args) =>
  new Promise((resolve, reject) =>
    NodeChildProcess.execFile("gh", [...args], { timeout: 8_000, windowsHide: true, maxBuffer: 1 << 20 }, (error, stdout) =>
      error === null ? resolve(stdout) : reject(error),
    ),
  );

export const readNightly = async (repo: string, run: RunGh = runGh): Promise<NightlyStatus | null> => {
  try {
    const content = await run(["api", `repos/${repo}/contents/nightly.json?ref=baton/status`, "--jq", ".content"]);
    return parseNightly(Buffer.from(content.trim(), "base64").toString("utf8"));
  } catch {
    return null;
  }
};

const CACHE_MS = 30 * 60_000;

/** Asks at most every half hour; a failed read is remembered for that long too, so the Now page never waits on it. */
export const createNightlyCache = (repo: string, run?: RunGh, now: () => number = Date.now) => {
  let at = Number.NEGATIVE_INFINITY;
  let held: NightlyStatus | null = null;
  return async (): Promise<NightlyStatus | null> => {
    if (now() - at < CACHE_MS) return held;
    at = now();
    held = await readNightly(repo, run);
    return held;
  };
};
