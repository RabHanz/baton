import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** Tessaya's memory (D150): items, a full-text index over their text, tombstones for sync, and which items each turn used. Additive. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS fabric_memory_items (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      source TEXT NOT NULL,
      source_ref TEXT,
      scope TEXT NOT NULL DEFAULT 'global',
      scope_ref TEXT,
      confidence REAL NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      proposed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_used_at TEXT,
      expires_at TEXT,
      superseded_by TEXT,
      origin TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX IF NOT EXISTS fabric_memory_items_updated ON fabric_memory_items (updated_at)`;

  // External-content index: the triggers keep it in step with fabric_memory_items.
  yield* sql`CREATE VIRTUAL TABLE IF NOT EXISTS fabric_memory_fts USING fts5(text, content='fabric_memory_items', content_rowid='rowid')`;
  yield* sql`
    CREATE TRIGGER IF NOT EXISTS fabric_memory_items_ai AFTER INSERT ON fabric_memory_items BEGIN
      INSERT INTO fabric_memory_fts(rowid, text) VALUES (new.rowid, new.text);
    END
  `;
  yield* sql`
    CREATE TRIGGER IF NOT EXISTS fabric_memory_items_ad AFTER DELETE ON fabric_memory_items BEGIN
      INSERT INTO fabric_memory_fts(fabric_memory_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
    END
  `;
  yield* sql`
    CREATE TRIGGER IF NOT EXISTS fabric_memory_items_au AFTER UPDATE OF text ON fabric_memory_items BEGIN
      INSERT INTO fabric_memory_fts(fabric_memory_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
      INSERT INTO fabric_memory_fts(rowid, text) VALUES (new.rowid, new.text);
    END
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS fabric_memory_tombstones (
      id TEXT PRIMARY KEY,
      deleted_at TEXT NOT NULL,
      origin TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS fabric_memory_uses (
      turn_ref TEXT NOT NULL,
      item_id TEXT NOT NULL,
      at TEXT NOT NULL,
      PRIMARY KEY (turn_ref, item_id)
    )
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS fabric_memory_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `;
});
