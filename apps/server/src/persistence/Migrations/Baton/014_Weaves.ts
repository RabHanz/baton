import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** Messages between sessions (D149): who, when, what, delivered, replied. Additive. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS fabric_weaves (
      id TEXT PRIMARY KEY,
      from_label TEXT NOT NULL,
      to_label TEXT NOT NULL,
      to_pane TEXT NOT NULL,
      text TEXT NOT NULL,
      status TEXT NOT NULL,
      reason TEXT,
      job TEXT,
      tries INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      delivered_at INTEGER,
      replied_at INTEGER,
      reply TEXT
    )
  `;
  yield* sql`CREATE INDEX IF NOT EXISTS fabric_weaves_status ON fabric_weaves (status, created_at)`;
});
