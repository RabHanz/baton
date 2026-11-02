// @effect-diagnostics nodeBuiltinImport:off globalTimers:off
/**
 * Memory between servers (D150, MEMORY.md section 6), switched by `baton-memory.json` in the state
 * folder and off by default. The window is connected to every server he uses, so it does the carrying:
 * the servers keep their own cursors and decide by last writer. Nothing here sees memory text.
 */
import * as NodeFS from "node:fs";

import type { MemoryCall } from "./memoryClient.ts";

export const SYNC_EVERY_MS = 10 * 60_000;

export const createMemorySync = (input: {
  readonly file: string;
  readonly call: MemoryCall;
  readonly everyMs?: number;
}) => {
  const enabled = (): boolean => {
    try {
      return (JSON.parse(NodeFS.readFileSync(input.file, "utf8")) as { sync?: unknown }).sync === true;
    } catch {
      return false;
    }
  };
  const setEnabled = (on: boolean): void => {
    NodeFS.writeFileSync(input.file, `${JSON.stringify({ sync: on })}\n`);
  };
  const run = async (): Promise<string> => {
    if (!enabled()) return "Memory sync is off.";
    try {
      const out = (await input.call("sync", {})) as { servers?: number; applied?: number } | null;
      if ((out?.servers ?? 0) < 2) return "Only one server is connected, so there is nothing to sync.";
      return `Synced ${out?.applied ?? 0} changes across ${out?.servers} servers.`;
    } catch (error) {
      return error instanceof Error ? error.message : "Sync did not work.";
    }
  };
  return {
    enabled,
    setEnabled,
    run,
    /** Runs on a timer; stops with the returned function. A skipped round (off) costs nothing. */
    start: (): (() => void) => {
      const timer = setInterval(() => void run(), input.everyMs ?? SYNC_EVERY_MS);
      timer.unref();
      return () => clearInterval(timer);
    },
  };
};
