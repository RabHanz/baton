// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off globalDate:off globalDateInEffect:off
/**
 * Writes into the live-thread message queue that `scripts/baton/live/baton-live-acp.mjs` drains:
 * one JSON file per Claude session id under `~/.t3/baton/live-queue`. A text item is typed into the
 * session's pane once it has one; a `note` item is only shown in that session's thread.
 * shortcut: read-modify-write without a lock, so an append can lose to a drain that rewrites at the
 * same instant; move to an append-only log if that is ever seen.
 */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

export const liveQueueDir = (): string =>
  process.env["BATON_LIVE_QUEUE_DIR"] ??
  NodePath.join(NodeOS.homedir(), ".t3", "baton", "live-queue");

const queueFile = (dir: string, sessionId: string): string =>
  NodePath.join(dir, `${sessionId.replace(/[^A-Za-z0-9_-]/g, "_")}.json`);

/** Adds one item at the end of a session's queue; returns how many are waiting. */
export const appendLiveQueue = (
  dir: string,
  sessionId: string,
  item: { readonly text: string; readonly shown: string; readonly kind?: "note" },
): number => {
  const file = queueFile(dir, sessionId);
  let items: unknown[] = [];
  try {
    const parsed: unknown = JSON.parse(NodeFS.readFileSync(file, "utf8"));
    if (Array.isArray(parsed)) items = parsed;
  } catch {}
  items.push({ tries: 0, at: new Date().toISOString(), ...item });
  NodeFS.mkdirSync(dir, { recursive: true });
  const temp = `${file}.tmp`;
  NodeFS.writeFileSync(temp, JSON.stringify(items), { mode: 0o600 });
  NodeFS.renameSync(temp, file);
  return items.length;
};
