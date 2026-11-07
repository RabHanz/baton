// @effect-diagnostics globalTimers:off
/**
 * Where the Sessions area gets its rows and sends its actions (D138). While T3's window is up, its sidebar pushes
 * every live session across the connected environments when they change, and opening a thread or typing to a pane go
 * back through the sidebar's own handlers, the paths a click in T3 takes. With the window closed, this machine's
 * server lists its own sessions and each linked environment's (GEN-6), and only its own panes are typed into.
 */
import type {
  BatonSessionRequest,
  BatonSessionSummary,
  BatonUsageSummary,
} from "@t3tools/baton-contracts";
import * as Electron from "electron";

import {
  BATON_SESSION_REQUEST_CHANNEL,
  BATON_SESSION_RESPONSE_CHANNEL,
  BATON_SESSIONS_SNAPSHOT_CHANNEL,
  BATON_USAGE_CHANNEL,
} from "../channels.ts";
import { answerOnDoor } from "./catalogDoor.ts";
import { closedWindowSend, requestFor, sendRefusal } from "./sessionRows.ts";

const ANSWER_MS = 4_000;
/** The window may still be loading when the first request goes out; the sidebar claims it late. */
const ATTEMPTS = 3;
/** How often the closed-window list is read from this machine's server; each read asks every linked environment. */
const DOOR_LIST_MS = 30_000;
const WINDOW_LOOK_MS = 5_000;

export interface SessionsBridge {
  readonly rows: () => ReadonlyArray<BatonSessionSummary>;
  readonly usage: () => ReadonlyArray<BatonUsageSummary>;
  /** What the list cannot show right now, in plain sentences: a computer not answering, an old list. */
  readonly notes: () => ReadonlyArray<string>;
  /** Open a session's thread (`text` null) or type to its pane. Resolves to a plain line. */
  readonly act: (id: string, text: string | null) => Promise<string>;
  /** This machine's server as its session list names it; null until the list was read through the door. */
  readonly here: () => { readonly environmentId: string; readonly label: string } | null;
  /** The same, reading the list first if it was not read yet, and never opening the window. */
  readonly ready: () => Promise<{ readonly environmentId: string; readonly label: string } | null>;
  /** A computer's name as the session list shows it. */
  readonly labelOf: (environmentId: string) => string;
  /** Any request to the sidebar, or with T3's window closed to this machine's server; null when nothing answered in time. */
  readonly request: (
    request: BatonSessionRequest,
    waitMs?: number,
  ) => Promise<{ ok: boolean; detail: string } | null>;
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
  /** This machine's own server, and whether T3's window is up; without them the window is the only source. */
  readonly direct?: (method: string, input: unknown) => Promise<unknown>;
  readonly mainWindowUp?: () => Promise<boolean>;
}): SessionsBridge => {
  let rows: ReadonlyArray<BatonSessionSummary> = [];
  let usage: ReadonlyArray<BatonUsageSummary> = [];
  let nextId = 0;
  const pending = new Map<number, (answer: { ok: boolean; detail: string }) => void>();

  /** Where the rows came from: the window's push, or this machine's server once the window closed. */
  let source: "window" | "door" = "window";
  let notes: ReadonlyArray<string> = [];
  Electron.ipcMain.on(BATON_SESSIONS_SNAPSHOT_CHANNEL, (_event, message: unknown) => {
    if (!Array.isArray(message)) return;
    rows = message.filter(isRow);
    source = "window";
    notes = [];
    input.onChange();
  });
  Electron.ipcMain.on(BATON_USAGE_CHANNEL, (_event, message: unknown) => {
    if (!Array.isArray(message)) return;
    usage = message.filter(
      (row): row is BatonUsageSummary =>
        typeof row === "object" &&
        row !== null &&
        typeof (row as BatonUsageSummary).account === "string" &&
        Array.isArray((row as BatonUsageSummary).windows),
    );
    input.onChange();
  });
  Electron.ipcMain.on(BATON_SESSION_RESPONSE_CHANNEL, (_event, message: unknown) => {
    if (typeof message !== "object" || message === null) return;
    const { id, ok, detail } = message as { id?: unknown; ok?: unknown; detail?: unknown };
    if (typeof id !== "number") return;
    pending.get(id)?.({ ok: ok === true, detail: typeof detail === "string" ? detail : "" });
  });

  const direct = input.direct;
  const mainWindowUp = input.mainWindowUp;
  const windowClosed = async () =>
    direct !== undefined && mainWindowUp !== undefined && !(await mainWindowUp());
  // The window's push stays the source while it is up; this never opens it.
  let here: { readonly environmentId: string; readonly label: string } | null = null;
  const readDoor = async () => {
    if (!(await windowClosed())) return;
    const value = (await direct!("baton.sessions.across", {}).catch(() => null)) as {
      sessions?: unknown;
      unreachable?: ReadonlyArray<{ label?: unknown }>;
      here?: { environmentId?: unknown; label?: unknown };
    } | null;
    if (!Array.isArray(value?.sessions)) {
      // The window's rows cannot be acted on with it closed; the server's last answer stays, said to be old.
      if (source === "window") rows = [];
      notes = ["This computer's server did not answer, so these sessions may be out of date."];
    } else {
      rows = value.sessions.filter(isRow);
      const { environmentId, label } = value.here ?? {};
      if (typeof environmentId === "string" && typeof label === "string")
        here = { environmentId, label };
      notes = (value.unreachable ?? []).flatMap((peer) =>
        typeof peer.label === "string"
          ? [`${peer.label} isn't answering, so its sessions are not listed.`]
          : [],
      );
    }
    source = "door";
    input.onChange();
  };
  const labelOf = (environmentId: string) =>
    rows.find(
      (row) =>
        row.pane?.environmentId === environmentId || row.thread?.environmentId === environmentId,
    )?.box ?? "that computer";
  // A cheap look at the window every few seconds: the server is read at once when it closes, then every 30 s.
  if (direct !== undefined && mainWindowUp !== undefined) {
    let ticks = 0;
    setInterval(() => {
      ticks += 1;
      void mainWindowUp().then((up) => {
        if (!up && (source === "window" || ticks % (DOOR_LIST_MS / WINDOW_LOOK_MS) === 0))
          void readDoor();
      });
    }, WINDOW_LOOK_MS).unref();
  }

  const ask = async (
    request: unknown,
    waitMs = ANSWER_MS,
  ): Promise<{ ok: boolean; detail: string } | null> => {
    const window = await input.ensureMainWindow();
    const id = ++nextId;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve(null);
      }, waitMs);
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
    usage: () => usage,
    notes: () => notes,
    here: () => here,
    ready: async () => {
      if (here === null && (await windowClosed())) await readDoor();
      return here;
    },
    labelOf,
    request: async (request, waitMs) => {
      // Opening a thread and typing over T3's own session keep the window's path, which brings the window up.
      if (request.kind === "open" || request.kind === "send" || !(await windowClosed()))
        return ask(request, waitMs);
      if (here === null) await readDoor();
      return here === null ? null : answerOnDoor(request, { here, labelOf, direct: direct! });
    },
    act: async (id, text) => {
      const row = rows.find((s) => id === `n:${s.key}`);
      const refused = text === null || row === undefined ? null : sendRefusal(row);
      if (refused !== null) return refused;
      if (text !== null && row !== undefined && (await windowClosed())) {
        const body = text.trim();
        if (body.length === 0) return "Nothing to send.";
        const call = closedWindowSend(row, body);
        if (typeof call === "string") return call;
        const sent = (await direct!(call.method, call.input).catch((error: unknown) => ({
          delivered: false,
          detail: error instanceof Error ? error.message : "Not sent.",
        }))) as { delivered?: boolean; detail?: string };
        return sent.delivered === true ? "Sent." : sent.detail || "Not sent.";
      }
      const request = requestFor(rows, id, text);
      if (request === null)
        return text === null ? "That session has no thread to open." : "Nothing to send.";
      if (request.kind === "open") input.openMainWindow();
      // A send is typed by the time it could time out: only opening is retried, or a slow answer types it twice.
      for (let attempt = 0; attempt < (request.kind === "open" ? ATTEMPTS : 1); attempt += 1) {
        const answer = await ask(request);
        if (answer !== null) return answer.detail || (answer.ok ? "Done." : "That did not work.");
      }
      return request.kind === "open"
        ? "T3 did not answer. Open sessions, then try again."
        : "T3 did not answer in time, so whether it was sent is not known. Look at the session before sending again.";
    },
  };
};
