import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** A mirrored question can need a permission to answer from the phone (cloud approvals). Additive. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE fabric_phone_prompts ADD COLUMN needs TEXT`;
});
