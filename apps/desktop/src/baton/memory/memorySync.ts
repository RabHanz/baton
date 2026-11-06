// @effect-diagnostics nodeBuiltinImport:off globalTimers:off
/**
 * Memory between servers (MEMORY.md section 6), off by default. The window carries it; the servers keep the cursors.
 * Any server but this app's own syncs only with its sync-only credential, kept here wrapped by the operating system.
 */
import * as NodeFS from "node:fs";

import type { MemoryCall } from "./memoryClient.ts";

export const SYNC_EVERY_MS = 10 * 60_000;

/** A server the window is connected to, and whether this machine holds its sync credential. */
export interface SyncPeer {
  readonly environmentId: string;
  readonly label: string;
  /** This app's own server: it syncs through the app's own session and needs no credential. */
  readonly local: boolean;
  readonly paired: boolean;
}

export const createMemorySync = (input: {
  readonly file: string;
  readonly call: MemoryCall;
  readonly everyMs?: number;
  /** Where the peers' credentials are kept; absent, none are kept and only this app's own server syncs. */
  readonly peersFile?: string;
  /** The operating system's wrapping (Electron `safeStorage`), injected so tests need no Electron. */
  readonly protect?: (plain: string) => string;
  readonly unprotect?: (wrapped: string) => string;
}) => {
  const protect = input.protect ?? ((plain: string) => plain);
  const unprotect = input.unprotect ?? ((wrapped: string) => wrapped);
  const enabled = (): boolean => {
    try {
      return (
        (JSON.parse(NodeFS.readFileSync(input.file, "utf8")) as { sync?: unknown }).sync === true
      );
    } catch {
      return false;
    }
  };
  const setEnabled = (on: boolean): void => {
    NodeFS.writeFileSync(input.file, `${JSON.stringify({ sync: on })}\n`);
  };

  const readTokens = (): Record<string, string> => {
    if (input.peersFile === undefined) return {};
    try {
      const wrapped = JSON.parse(NodeFS.readFileSync(input.peersFile, "utf8")) as Record<
        string,
        unknown
      >;
      const out: Record<string, string> = {};
      for (const [id, value] of Object.entries(wrapped)) {
        if (typeof value !== "string") continue;
        try {
          out[id] = unprotect(value);
        } catch {
          // A credential this machine can no longer unwrap is as good as none: pair again.
        }
      }
      return out;
    } catch {
      return {};
    }
  };
  const writeTokens = (tokens: Readonly<Record<string, string>>): void => {
    if (input.peersFile === undefined) return;
    const wrapped = Object.fromEntries(Object.entries(tokens).map(([id, t]) => [id, protect(t)]));
    NodeFS.writeFileSync(input.peersFile, `${JSON.stringify(wrapped)}\n`, { mode: 0o600 });
  };

  const run = async (): Promise<string> => {
    if (!enabled()) return "Memory sync is off.";
    try {
      const out = (await input.call("sync", { tokens: readTokens() })) as {
        servers?: number;
        applied?: number;
      } | null;
      if ((out?.servers ?? 0) < 2)
        return "Only one server is syncing, so there is nothing to carry. Pair the others for memory sync.";
      return `Synced ${out?.applied ?? 0} changes across ${out?.servers} servers.`;
    } catch (error) {
      return error instanceof Error ? error.message : "Sync did not work.";
    }
  };

  return {
    enabled,
    setEnabled,
    run,
    /** The servers the window is connected to, each with whether its walled memory can sync. */
    peers: async (): Promise<ReadonlyArray<SyncPeer>> => {
      const tokens = readTokens();
      const listed = (await input.call("syncPeers", {})) as ReadonlyArray<{
        environmentId: string;
        label: string;
        local: boolean;
      }> | null;
      return (listed ?? []).map((p) => ({
        ...p,
        paired: p.local || tokens[p.environmentId] !== undefined,
      }));
    },
    /** A one-time code for another machine to pair with this app's own server; it expires in minutes. */
    issue: async (): Promise<string> =>
      ((await input.call("syncPair", {})) as { code: string }).code,
    /** Trades that server's one-time code for its sync-only credential, and keeps it here. */
    link: async (environmentId: string, code: string): Promise<void> => {
      const out = (await input.call("syncLink", { environmentId, code })) as { token: string };
      writeTokens({ ...readTokens(), [environmentId]: out.token });
    },
    /** Drops that server's credential here; revoking it there ("Tessaya memory sync" in Sharing & access) ends it. */
    forget: (environmentId: string): void => {
      const { [environmentId]: _gone, ...rest } = readTokens();
      writeTokens(rest);
    },
    /** Runs on a timer; stops with the returned function. A skipped round (off) costs nothing. */
    start: (): (() => void) => {
      const timer = setInterval(() => void run(), input.everyMs ?? SYNC_EVERY_MS);
      timer.unref();
      return () => clearInterval(timer);
    },
  };
};

export type MemorySync = ReturnType<typeof createMemorySync>;
