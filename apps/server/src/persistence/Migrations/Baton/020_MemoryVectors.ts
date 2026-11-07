import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** Recall by meaning (MEM-13): one sentence vector per memory item, for the model and the text it was made from. Additive. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS fabric_memory_vectors (
      item_id TEXT PRIMARY KEY,
      model TEXT NOT NULL,
      text_hash TEXT NOT NULL,
      vector BLOB NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  // A forgotten or swept item takes its vector with it.
  yield* sql`
    CREATE TRIGGER IF NOT EXISTS fabric_memory_vectors_gone AFTER DELETE ON fabric_memory_items BEGIN
      DELETE FROM fabric_memory_vectors WHERE item_id = old.id;
    END
  `;
});
