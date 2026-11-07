import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * The weave table becomes the one queue for text waiting to be typed into a live session (item 5): `source` says
 * which way it came in (null: a weave; `thread`, `unbound`, `catalog`: the stores it replaces). Additive.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE fabric_weaves ADD COLUMN source TEXT`;
  yield* sql`CREATE INDEX IF NOT EXISTS fabric_weaves_pane ON fabric_weaves (to_pane, status)`;
});
