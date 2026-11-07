import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** Baton's own server settings, one value per key (L-76: what a thread does at its account's limit). Additive. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS fabric_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `;
});
