// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off globalDate:off globalDateInEffect:off
/**
 * Messages a live thread could not deliver (it had no session bound) are kept by the ACP agent in
 * `unbound-messages.ndjson`. The server never edits that file: what it learns and does is appended to
 * `unbound-ledger.ndjson` (the thread an entry belongs to; claimed before a resend, released if the resend fails), so a
 * message is neither dropped nor sent twice. shortcut: both files only grow, compact them if they ever matter.
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { Effect } from "effect";

import type { BatonEngineShape } from "./BatonEngine.ts";
import { ThreadId } from "@t3tools/contracts";

export interface KeptMessage {
  readonly id: string;
  readonly at: string;
  readonly cwd: string | null;
  /** The thread's native session id when it was kept (`baton-unbound-...`). */
  readonly sessionId: string | null;
  readonly threadId: string | null;
  readonly text: string;
}

export type LedgerLine = {
  readonly id: string;
  readonly threadId?: string;
  readonly state?: "claimed" | "released";
};

const KEPT_FILE = "unbound-messages.ndjson";
const LEDGER_FILE = "unbound-ledger.ndjson";

const lines = (file: string): ReadonlyArray<unknown> => {
  let text = "";
  try {
    text = NodeFS.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  return text.split("\n").flatMap((line) => {
    try {
      return line.trim() === "" ? [] : [JSON.parse(line) as unknown];
    } catch {
      return [];
    }
  });
};

const str = (value: unknown): string | null => (typeof value === "string" ? value : null);

export const readKept = (dir: string): ReadonlyArray<KeptMessage> =>
  lines(NodePath.join(dir, KEPT_FILE)).flatMap((raw) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const text = str(r["text"]);
    if (text === null || text.trim() === "") return [];
    const at = str(r["at"]) ?? "";
    return [
      {
        // Entries kept before ids existed get a stable one from their words and time.
        id:
          str(r["id"]) ??
          NodeCrypto.createHash("sha1").update(`${at}|${text}`).digest("hex").slice(0, 16),
        at,
        cwd: str(r["cwd"]),
        sessionId: str(r["sessionId"]),
        threadId: str(r["threadId"]),
        text,
      },
    ];
  });

export const readLedger = (dir: string): ReadonlyArray<LedgerLine> =>
  lines(NodePath.join(dir, LEDGER_FILE)).flatMap((raw) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const id = str(r["id"]);
    if (id === null) return [];
    const threadId = str(r["threadId"]);
    const state = r["state"] === "claimed" || r["state"] === "released" ? r["state"] : undefined;
    return [{ id, ...(threadId === null ? {} : { threadId }), ...(state ? { state } : {}) }];
  });

export const appendLedger = (dir: string, line: LedgerLine): void => {
  NodeFS.mkdirSync(dir, { recursive: true });
  NodeFS.appendFileSync(NodePath.join(dir, LEDGER_FILE), `${JSON.stringify(line)}\n`);
};

/** The kept messages still waiting (not claimed), each with its thread when known. */
export const pendingKept = (
  kept: ReadonlyArray<KeptMessage>,
  ledger: ReadonlyArray<LedgerLine>,
): ReadonlyArray<KeptMessage & { readonly thread: string | null }> => {
  const thread = new Map<string, string>();
  const claimed = new Set<string>();
  for (const line of ledger) {
    if (line.threadId !== undefined) thread.set(line.id, line.threadId);
    if (line.state === "claimed") claimed.add(line.id);
    if (line.state === "released") claimed.delete(line.id);
  }
  return kept
    .filter((entry) => !claimed.has(entry.id))
    .map((entry) => ({ ...entry, thread: entry.threadId ?? thread.get(entry.id) ?? null }));
};

const LIVE_PREFIX = "baton-live4:";
/** A live thread's terminal session id is in its own id. */
export const sessionOfThread = (threadId: string): string | null =>
  threadId.startsWith(LIVE_PREFIX) ? threadId.slice(LIVE_PREFIX.length) : null;

/** Writes the thread for entries that only know the thread's native session id. */
export const stampKept = Effect.fn("UnboundMessages.stampKept")(function* (
  engine: BatonEngineShape,
  dir: string,
) {
  const open = pendingKept(readKept(dir), readLedger(dir)).filter(
    (entry) => entry.thread === null && entry.sessionId !== null,
  );
  if (open.length === 0) return;
  const wanted = new Set(
    open.flatMap((entry) => (entry.sessionId === null ? [] : [entry.sessionId])),
  );
  const byNative = new Map<string, string>();
  for (const shell of yield* engine.threadShells) {
    if (!String(shell.id).startsWith(LIVE_PREFIX)) continue;
    const nativeId = (yield* engine.activeProviderThread(shell.id))?.nativeThreadRef?.nativeId;
    if (typeof nativeId === "string" && wanted.has(nativeId))
      byNative.set(nativeId, String(shell.id));
  }
  for (const entry of open) {
    const thread = byNative.get(entry.sessionId!);
    if (thread !== undefined) appendLedger(dir, { id: entry.id, threadId: thread });
  }
});

/**
 * Sends kept messages of a thread back through it once, oldest first. Automatic passes pass `bound` (only when the
 * thread is on its running session); a person's Retry does not, and the message is kept again if still unbound.
 * Claimed before the send and released if it fails, so it is never sent twice nor lost.
 */
export const resendKept = Effect.fn("UnboundMessages.resendKept")(function* (
  engine: BatonEngineShape,
  input: {
    readonly dir: string;
    readonly threadId: string;
    readonly entryId?: string;
    readonly bound: boolean;
  },
) {
  if (!input.bound && input.entryId === undefined) return { sent: 0, failed: 0 };
  const shell = yield* engine.threadShell(ThreadId.make(input.threadId));
  if (shell === null || (shell.activeRunId !== null && shell.activeRunId !== undefined))
    return { sent: 0, failed: 0 };
  const mine = pendingKept(readKept(input.dir), readLedger(input.dir)).filter(
    (entry) =>
      entry.thread === input.threadId &&
      (input.entryId === undefined || entry.id === input.entryId),
  );
  // One message per pass: a turn is running after the first, and the rest follow in order.
  const next = mine[0];
  if (next === undefined) return { sent: 0, failed: 0 };
  appendLedger(input.dir, { id: next.id, state: "claimed" });
  const ok = yield* engine.sendMessage({
    tag: "unbound-retry",
    threadId: ThreadId.make(input.threadId),
    text: next.text,
  });
  if (!ok) appendLedger(input.dir, { id: next.id, state: "released" });
  return ok ? { sent: 1, failed: 0 } : { sent: 0, failed: 1 };
});
