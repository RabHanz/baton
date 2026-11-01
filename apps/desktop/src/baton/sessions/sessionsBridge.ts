// @effect-diagnostics globalTimers:off
/**
 * Where the Sessions area gets its rows and sends its actions (D138). The sidebar in T3's window
 * already holds every live session across the connected environments; it pushes them here when
 * they change, so nothing is polled. Opening a thread and typing to a pane go back the same way,
 * through the sidebar's own handlers, so they take the paths a click in T3 would.
 */
import type { BatonSessionSummary } from "@t3tools/baton-contracts";
import * as Electron from "electron";

import {
  BATON_SESSION_REQUEST_CHANNEL,
  BATON_SESSION_RESPONSE_CHANNEL,
  BATON_SESSIONS_SNAPSHOT_CHANNEL,
} from "../channels.ts";
import { requestFor } from "./sessionRows.ts";

const ANSWER_MS = 4_000;
/** The window may still be loading when the first request goes out; the sidebar claims it late. */
const ATTEMPTS = 3;

export interface SessionsBridge {
  readonly rows: () => ReadonlyArray<BatonSessionSummary>;
  /** Open a session's thread (`text` null) or type to its pane. Resolves to a plain line. */
  readonly act: (id: string, text: string | null) => Promise<string>;
}

const isRow = (value: unknown): value is BatonSessionSummary => {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row["key"] === "string" &&
    typeof row["project"] === "string" &&
    typeof row["session"] === "string" &&
    typeof row["box"] === "string" &&
    (row["state"] === "working" || row["state"] === "waiting" || row["state"] === "idle")
  );
};

export const createSessionsBridge = (input: {
  readonly ensureMainWindow: () => Promise<Electron.BrowserWindow>;
  readonly openMainWindow: () => void;
  readonly onChange: () => void;
}): SessionsBridge => {
  let rows: ReadonlyArray<BatonSessionSummary> = [];
  let nextId = 0;
  const pending = new Map<number, (answer: { ok: boolean; detail: string }) => void>();

  Electron.ipcMain.on(BATON_SESSIONS_SNAPSHOT_CHANNEL, (_event, message: unknown) => {
    if (!Array.isArray(message)) return;
    rows = message.filter(isRow);
    input.onChange();
  });
  Electron.ipcMain.on(BATON_SESSION_RESPONSE_CHANNEL, (_event, message: unknown) => {
    if (typeof message !== "object" || message === null) return;
    const { id, ok, detail } = message as { id?: unknown; ok?: unknown; detail?: unknown };
    if (typeof id !== "number") return;
    pending.get(id)?.({ ok: ok === true, detail: typeof detail === "string" ? detail : "" });
  });

  const ask = async (request: unknown): Promise<{ ok: boolean; detail: string } | null> => {
    const window = await input.ensureMainWindow();
    const id = ++nextId;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve(null);
      }, ANSWER_MS);
      pending.set(id, (answer) => {
        clearTimeout(timer);
        pending.delete(id);
        resolve(answer);
      });
      window.webContents.send(BATON_SESSION_REQUEST_CHANNEL, { id, request });
    });
  };

  return {
    rows: () => rows,
    act: async (id, text) => {
      const request = requestFor(rows, id, text);
      if (request === null)
        return text === null ? "That session has no thread to open." : "Nothing to send.";
      if (request.kind === "open") input.openMainWindow();
      for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
        const answer = await ask(request);
        if (answer !== null) return answer.detail || (answer.ok ? "Done." : "That did not work.");
      }
      return "T3 did not answer. Open sessions, then try again.";
    },
  };
};
