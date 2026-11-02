// @effect-diagnostics nodeBuiltinImport:off globalTimers:off
/** The few facts "what works right now" needs, each checked quickly and remembered for a minute. */
import * as NodeChildProcess from "node:child_process";
import * as NodeDns from "node:dns";

import type { Probe } from "@t3tools/baton-shared/degraded";

const withTimeout = <T>(work: Promise<T>, ms: number): Promise<T | null> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    work.then(
      (v) => (clearTimeout(timer), resolve(v)),
      () => (clearTimeout(timer), resolve(null)),
    );
  });

export const createProbes = (input: {
  readonly lookup?: (host: string) => Promise<unknown>;
  readonly runVersion?: (binary: string) => Promise<boolean>;
  readonly now?: () => number;
}) => {
  const now = input.now ?? Date.now;
  const lookup = input.lookup ?? ((h: string) => NodeDns.promises.lookup(h));
  const runVersion =
    input.runVersion ??
    ((binary: string) =>
      new Promise<boolean>((resolve) =>
        NodeChildProcess.execFile(
          binary,
          ["--version"],
          { timeout: 3_000, windowsHide: true, shell: process.platform === "win32" },
          (e) => resolve(e === null),
        ),
      ));
  let cache: { at: number; network: Probe; claude: Probe; binary: string } | null = null;
  return async (claudeBinary: string): Promise<{ network: Probe; claude: Probe }> => {
    if (cache !== null && now() - cache.at < 60_000 && cache.binary === claudeBinary) return cache;
    const network = (await withTimeout(lookup("github.com"), 2_000)) === null ? false : true;
    const claude = (await withTimeout(runVersion(claudeBinary), 4_000)) === true;
    cache = { at: now(), network, claude, binary: claudeBinary };
    return cache;
  };
};
