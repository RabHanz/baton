// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalRandom:off
/**
 * Every dictation and spoken turn he has had, kept forever on this machine: what was heard, what it
 * became, how it was tidied, where it went. One SQLite file under the state dir (node:sqlite, the
 * same one the Wispr import reads with). Nothing here leaves the machine.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { DatabaseSync } from "node:sqlite";

export type TurnKind = "dictation" | "spoken";
/** ok: tidied. raw: inserted as heard (tidy-up off or failed). none: spoken turn, nothing tidied. */
export type TidyStatus = "ok" | "raw" | "failed" | "none";

export interface HistoryTurn {
  readonly id: string;
  /** ISO time. */
  readonly at: string;
  readonly kind: TurnKind;
  readonly app: string;
  readonly raw: string;
  readonly cleaned: string | null;
  readonly status: TidyStatus;
  readonly model: string | null;
  /** "oneshot", "stream" or "hold key". */
  readonly delivery: string | null;
  readonly audio: string | null;
  /** He fixed words in the field afterwards. */
  readonly corrected: boolean;
  /** The text in the field after he fixed it, when the field could be read back. */
  readonly fixed: string | null;
  /** How long he spoke, when known; for words per minute. */
  readonly seconds: number | null;
  readonly error: string | null;
}

export interface History {
  readonly add: (
    turn: Omit<HistoryTurn, "id" | "corrected" | "audio" | "fixed" | "seconds"> & {
      readonly seconds?: number | null;
    } & { readonly audio?: string | null },
  ) => string;
  readonly update: (
    id: string,
    change: Partial<
      Pick<
        HistoryTurn,
        | "raw"
        | "cleaned"
        | "status"
        | "model"
        | "error"
        | "audio"
        | "corrected"
        | "fixed"
        | "seconds"
      >
    >,
  ) => void;
  readonly get: (id: string) => HistoryTurn | null;
  /** Newest first. `query` matches the raw and cleaned text and the app. */
  readonly list: (options?: {
    readonly query?: string;
    readonly before?: string;
    readonly limit?: number;
  }) => ReadonlyArray<HistoryTurn>;
  readonly remove: (id: string) => HistoryTurn | null;
  readonly close: () => void;
}

const COLUMNS =
  "id, at, kind, app, raw, cleaned, status, model, delivery, audio, corrected, error, fixed, seconds";

type Row = Record<string, string | number | null>;
const toTurn = (row: Row): HistoryTurn => ({
  id: String(row["id"]),
  at: String(row["at"]),
  kind: row["kind"] === "spoken" ? "spoken" : "dictation",
  app: String(row["app"] ?? ""),
  raw: String(row["raw"] ?? ""),
  cleaned: row["cleaned"] === null ? null : String(row["cleaned"]),
  status: (["ok", "raw", "failed", "none"].includes(String(row["status"]))
    ? row["status"]
    : "none") as TidyStatus,
  model: row["model"] === null ? null : String(row["model"]),
  delivery: row["delivery"] === null ? null : String(row["delivery"]),
  audio: row["audio"] === null ? null : String(row["audio"]),
  corrected: row["corrected"] === 1,
  seconds: typeof row["seconds"] === "number" ? row["seconds"] : null,
  fixed: row["fixed"] === null || row["fixed"] === undefined ? null : String(row["fixed"]),
  error: row["error"] === null ? null : String(row["error"]),
});

export const openHistory = (
  file: string,
  newId: () => string = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
): History => {
  if (file !== ":memory:") NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`create table if not exists turns (
    id text primary key, at text not null, kind text not null, app text not null default '',
    raw text not null, cleaned text, status text not null, model text, delivery text,
    audio text, corrected integer not null default 0, error text);
    create index if not exists turns_at on turns (at desc);`);
  if (
    !(db.prepare("pragma table_info(turns)").all() as Array<{ name: string }>).some(
      (c) => c.name === "fixed",
    )
  ) {
    db.exec("alter table turns add column fixed text");
  }
  if (
    !(db.prepare("pragma table_info(turns)").all() as Array<{ name: string }>).some(
      (c) => c.name === "seconds",
    )
  ) {
    db.exec("alter table turns add column seconds real");
  }
  const get = (id: string): HistoryTurn | null => {
    const row = db.prepare(`select ${COLUMNS} from turns where id = ?`).get(id) as Row | undefined;
    return row === undefined ? null : toTurn(row);
  };
  return {
    add: (turn) => {
      const id = newId();
      db.prepare(
        `insert into turns (id, at, kind, app, raw, cleaned, status, model, delivery, audio, corrected, error, seconds) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      ).run(
        id,
        turn.at,
        turn.kind,
        turn.app,
        turn.raw,
        turn.cleaned,
        turn.status,
        turn.model,
        turn.delivery,
        turn.audio ?? null,
        turn.error,
        turn.seconds ?? null,
      );
      return id;
    },
    update: (id, change) => {
      const entries = Object.entries(change).filter(([, v]) => v !== undefined);
      if (entries.length === 0) return;
      const sets = entries.map(([key]) => `${key} = ?`).join(", ");
      const values = entries.map(([, v]) =>
        typeof v === "boolean" ? (v ? 1 : 0) : (v as string | null),
      );
      db.prepare(`update turns set ${sets} where id = ?`).run(...values, id);
    },
    get,
    list: (options = {}) => {
      const where: string[] = [];
      const args: string[] = [];
      if (options.query !== undefined && options.query.trim() !== "") {
        const like = `%${options.query.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
        where.push(
          "(raw like ? escape '\\' or cleaned like ? escape '\\' or app like ? escape '\\')",
        );
        args.push(like, like, like);
      }
      if (options.before !== undefined) {
        where.push("at < ?");
        args.push(options.before);
      }
      const rows = db
        .prepare(
          `select ${COLUMNS} from turns ${where.length > 0 ? `where ${where.join(" and ")}` : ""} order by at desc limit ?`,
        )
        .all(...args, options.limit ?? 100) as Row[];
      return rows.map(toTurn);
    },
    remove: (id) => {
      const turn = get(id);
      if (turn !== null) db.prepare("delete from turns where id = ?").run(id);
      return turn;
    },
    close: () => db.close(),
  };
};
