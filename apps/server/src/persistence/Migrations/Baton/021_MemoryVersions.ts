import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** Memory history (KIRO-4): each item's earlier wordings, with when, who and why. Additive. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS fabric_memory_versions (
      item_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      text TEXT NOT NULL,
      kind TEXT NOT NULL,
      at TEXT NOT NULL,
      by TEXT NOT NULL,
      why TEXT NOT NULL,
      PRIMARY KEY (item_id, version)
    )
  `;
});
