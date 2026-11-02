import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** The commitments ledger (D149), shared by his devices. Additive. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS fabric_commitments (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      owner TEXT NOT NULL,
      due INTEGER,
      status TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      closed_at INTEGER,
      ref TEXT
    )
  `;
  yield* sql`CREATE INDEX IF NOT EXISTS fabric_commitments_status ON fabric_commitments (status, due)`;
});
