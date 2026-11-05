import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** The Record: one timeline of what happened, who did it, for which project. Additive. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS fabric_record (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      kind TEXT NOT NULL,
      actor TEXT NOT NULL,
      project TEXT,
      ref TEXT,
      subject TEXT NOT NULL,
      outcome TEXT NOT NULL,
      detail TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX IF NOT EXISTS fabric_record_at ON fabric_record (at)`;
  yield* sql`CREATE INDEX IF NOT EXISTS fabric_record_project ON fabric_record (project, at)`;
});
