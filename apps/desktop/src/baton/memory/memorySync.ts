// @effect-diagnostics nodeBuiltinImport:off globalTimers:off
/**
 * Memory between servers (MEMORY.md section 6), off by default. The window carries it; the servers keep the cursors.
 * Any server but this app's own syncs only with its sync-only credential, kept here only when the OS can encrypt it.
 */
import * as NodeFS from "node:fs";

import type { MemoryCall } from "./memoryClient.ts";

export const SYNC_EVERY_MS = 10 * 60_000;

/** A server the window is connected to, and whether this machine holds a live sync credential for it. */
export interface SyncPeer {
  readonly environmentId: string;
  readonly label: string;
  /** This app's own server: it syncs through the app's own session and needs no credential. */
  readonly local: boolean;
  readonly paired: boolean;
  /** When the credential stops working (ms); it cannot be renewed, only paired again. */
  readonly expiresAt?: number;
}

/** What the window sends a server's sync calls with: the token, and the only origin it may go to. */
interface PeerCredential {
  readonly origin: string;
  readonly token: string;
  readonly expiresAt: number;
}

/** The operating system's encryption (Electron `safeStorage`); null where it cannot encrypt for real. */
export interface SyncProtection {
  readonly protect: (plain: string) => string;
  readonly unprotect: (wrapped: string) => string;
}

export const createMemorySync = (input: {
  readonly file: string;
  readonly call: MemoryCall;
  readonly everyMs?: number;
  /** Where the peers' credentials are kept; absent, none are kept and only this app's own server syncs. */
  readonly peersFile?: string;
  /** Asked each time: encryption can become unavailable, and then nothing is stored or read. */
  readonly protection?: () => SyncProtection | null;
  readonly now?: () => number;
}) => {
  const now = input.now ?? Date.now;
  let lastPeers: ReadonlyArray<SyncPeer> = [];
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

  /** Live credentials only: one that cannot be decrypted, or has expired, counts as unpaired. */
  const readPeers = (): Record<string, PeerCredential> => {
    const protection = input.protection?.() ?? null;
    if (input.peersFile === undefined || protection === null) return {};
    let wrapped: Record<string, unknown>;
    try {
      wrapped = JSON.parse(NodeFS.readFileSync(input.peersFile, "utf8")) as Record<string, unknown>;
    } catch {
      return {};
    }
    const out: Record<string, PeerCredential> = {};
    for (const [id, value] of Object.entries(wrapped)) {
      if (typeof value !== "string") continue;
      try {
        const peer = JSON.parse(protection.unprotect(value)) as PeerCredential;
        if (
          typeof peer.token === "string" &&
          typeof peer.origin === "string" &&
          peer.expiresAt > now()
        )
          out[id] = peer;
      } catch {
        // Not decryptable here any more: as good as none, so the row asks to pair again.
      }
    }
    return out;
  };
  const writePeers = (peers: Readonly<Record<string, PeerCredential>>): void => {
    const protection = input.protection?.() ?? null;
    if (input.peersFile === undefined) return;
    if (protection === null)
      throw new Error(
        "This computer cannot keep the credential encrypted, so it was not saved. Walled memory will not sync with that server.",
      );
    const wrapped = Object.fromEntries(
      Object.entries(peers).map(([id, peer]) => [id, protection.protect(JSON.stringify(peer))]),
    );
    NodeFS.writeFileSync(input.peersFile, `${JSON.stringify(wrapped)}\n`, { mode: 0o600 });
  };
  const forget = (environmentId: string): void => {
    const { [environmentId]: _gone, ...rest } = readPeers();
    writePeers(rest);
  };

  const run = async (): Promise<string> => {
    if (!enabled()) return "Memory sync is off.";
    try {
      const out = (await input.call("sync", { peers: readPeers() })) as {
        servers?: number;
        applied?: number;
        refused?: ReadonlyArray<{ environmentId: string; label: string }>;
      } | null;
      // Revoked, or its session ended there: keeping it would only fail again.
      for (const gone of out?.refused ?? []) forget(gone.environmentId);
      const refused = (out?.refused ?? []).map(
        (gone) => `${gone.label} stopped accepting this computer's sync credential; pair it again.`,
      );
      const line =
        (out?.servers ?? 0) < 2
          ? "Only one server is syncing, so there is nothing to carry. Pair the others for memory sync."
          : `Synced ${out?.applied ?? 0} changes across ${out?.servers} servers.`;
      return [line, ...refused].join(" ");
    } catch (error) {
      return error instanceof Error ? error.message : "Sync did not work.";
    }
  };

  return {
    enabled,
    setEnabled,
    run,
    /** The servers the window is connected to; the last list when the window cannot be asked (it is closed). */
    peers: async (): Promise<ReadonlyArray<SyncPeer>> => {
      const listed = (await input.call("syncPeers", {}).catch(() => null)) as ReadonlyArray<{
        environmentId: string;
        label: string;
        local: boolean;
      }> | null;
      const live = readPeers();
      const rows = listed ?? lastPeers;
      lastPeers = rows.map((p) => {
        const peer = live[p.environmentId];
        return {
          environmentId: p.environmentId,
          label: p.label,
          local: p.local,
          paired: p.local || peer !== undefined,
          ...(peer === undefined ? {} : { expiresAt: peer.expiresAt }),
        };
      });
      return lastPeers;
    },
    /** A one-time code for another machine to pair with this app's own server; it expires in minutes. */
    issue: async (): Promise<string> =>
      ((await input.call("syncPair", {})) as { code: string }).code,
    /** Trades that server's one-time code for its sync-only credential, and keeps it here encrypted. */
    link: async (environmentId: string, code: string): Promise<void> => {
      if ((input.protection?.() ?? null) === null)
        throw new Error(
          "This computer cannot keep the credential encrypted, so it was not paired. Walled memory will not sync with that server.",
        );
      const out = (await input.call("syncLink", { environmentId, code })) as PeerCredential;
      writePeers({ ...readPeers(), [environmentId]: out });
    },
    /** Drops that server's credential here; revoking it there ("Tessaya memory sync" in Sharing & access) ends it. */
    forget,
    /** Runs on a timer; stops with the returned function. A skipped round (off) costs nothing. */
    start: (): (() => void) => {
      const timer = setInterval(() => void run(), input.everyMs ?? SYNC_EVERY_MS);
      timer.unref();
      return () => clearInterval(timer);
    },
  };
};

export type MemorySync = ReturnType<typeof createMemorySync>;
