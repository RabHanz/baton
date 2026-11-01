import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** A part that waits on others (the coordinator, D148): what it needs before it starts, as JSON; null for a job started at once. Additive. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE fabric_job_terms ADD COLUMN part_spec_json TEXT`;
});
