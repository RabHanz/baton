import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** When this server got each memory change, so a sync pages by arrival, not by the writer's clock. Older rows read their own stamp. Additive. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE fabric_memory_items ADD COLUMN received_at TEXT`;
  yield* sql`CREATE INDEX IF NOT EXISTS fabric_memory_items_received ON fabric_memory_items (COALESCE(received_at, updated_at))`;
  yield* sql`ALTER TABLE fabric_memory_tombstones ADD COLUMN received_at TEXT`;
});
