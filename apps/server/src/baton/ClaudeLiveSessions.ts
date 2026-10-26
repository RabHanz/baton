// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off globalDateInEffect:off globalDate:off
/**
 * Live Claude Code sessions on this machine, read from Claude Code's own
 * per-process descriptors (D68). Read-only: the `.key` files beside them are
 * never opened.
 */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import type { ClaudeLiveSession } from "@t3tools/baton-contracts";
import * as Effect from "effect/Effect";

const DEFAULT_SESSIONS_DIR = NodePath.join(NodeOS.homedir(), ".claude", "sessions");

const str = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

/** Herdr panes carry `HERDR_SESSION` + `HERDR_PANE_ID`; the default session needs no prefix. */
export const herdrPaneRef = (env: ReadonlyMap<string, string>): string | null => {
  const pane = env.get("HERDR_PANE_ID");
  if (pane === undefined || pane.length === 0) return null;
  const session = env.get("HERDR_SESSION");
  return session === undefined || session === "" || session === "default"
    ? pane
    : `${session}~${pane}`;
};

/** One descriptor, or null when it is not a live interactive session. */
export const parseClaudeSessionDescriptor = (
  json: string,
  input: {
    readonly alive: (pid: number) => boolean;
    readonly env: (pid: number) => ReadonlyMap<string, string>;
    readonly account: string | null;
  },
): ClaudeLiveSession | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const d = parsed as Record<string, unknown>;
  const pid = d["pid"];
  const sessionId = str(d["sessionId"]);
  const cwd = str(d["cwd"]);
  if (typeof pid !== "number" || sessionId === null || cwd === null) return null;
  // `claude -p` workers are not sessions anyone talks to.
  if (str(d["kind"]) !== "interactive") return null;
  // SDK-driven sessions belong to the program that runs them (T3 threads, automation);
  // nobody types into them and adopting one would kill its owner's work.
  if ((str(d["entrypoint"]) ?? "").startsWith("sdk")) return null;
  if (!input.alive(pid)) return null;
  const updated = d["updatedAt"];
  return {
    pid,
    sessionId,
    cwd,
    name: str(d["name"]),
    status: str(d["status"]),
    entrypoint: str(d["entrypoint"]),
    herdrPane: herdrPaneRef(input.env(pid)),
    tmux: str(d["tmux"]),
    account: input.account,
    updatedAt: typeof updated === "number" ? new Date(updated).toISOString() : null,
  };
};

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const environOf = (pid: number): ReadonlyMap<string, string> => {
  try {
    const raw = NodeFS.readFileSync(`/proc/${pid}/environ`, "utf8");
    const map = new Map<string, string>();
    for (const entry of raw.split("\0")) {
      const at = entry.indexOf("=");
      // Only Herdr's routing variables are kept; nothing else leaves /proc.
      if (at > 0 && entry.startsWith("HERDR_")) map.set(entry.slice(0, at), entry.slice(at + 1));
    }
    return map;
  } catch {
    return new Map();
  }
};

export const readClaudeLiveSessions = (input: {
  readonly account: string | null;
  readonly dir?: string;
}): Effect.Effect<ReadonlyArray<ClaudeLiveSession>> =>
  Effect.sync(() => {
    const dir = input.dir ?? DEFAULT_SESSIONS_DIR;
    let names: Array<string>;
    try {
      names = NodeFS.readdirSync(dir).filter((name) => /^\d+\.json$/.test(name));
    } catch {
      return [];
    }
    const sessions: Array<ClaudeLiveSession> = [];
    for (const name of names) {
      let json: string;
      try {
        json = NodeFS.readFileSync(NodePath.join(dir, name), "utf8");
      } catch {
        continue;
      }
      const session = parseClaudeSessionDescriptor(json, {
        alive,
        env: environOf,
        account: input.account,
      });
      if (session !== null) sessions.push(session);
    }
    return sessions.toSorted((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  });
