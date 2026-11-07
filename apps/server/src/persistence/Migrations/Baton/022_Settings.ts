import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** Baton's own server settings, one value per key, and the threads he keeps on their account (L-76). Additive. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS fabric_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS fabric_thread_account_keeps (
      thread_id TEXT PRIMARY KEY
    )
  `;
});
