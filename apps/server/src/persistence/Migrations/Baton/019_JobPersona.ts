import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** Which persona a job works for (its role, or the lead's "executive"), so its turns count against that persona's cap. Additive; null is the lead. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE fabric_job_terms ADD COLUMN persona TEXT`;
});
