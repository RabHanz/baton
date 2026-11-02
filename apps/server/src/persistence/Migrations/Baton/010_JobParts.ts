import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** A job can be a part of another (D148, the coordinator): the parent's id, null for a job of its own. Additive. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE fabric_job_terms ADD COLUMN parent_id TEXT`;
});
