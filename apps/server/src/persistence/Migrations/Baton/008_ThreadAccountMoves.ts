import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** A thread's account move waiting for its turn to end (D95). Additive; the row is deleted on use. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS fabric_thread_account_moves (
      thread_id TEXT PRIMARY KEY,
      instance_id TEXT NOT NULL,
      requested_at TEXT NOT NULL
    )
  `;
});
