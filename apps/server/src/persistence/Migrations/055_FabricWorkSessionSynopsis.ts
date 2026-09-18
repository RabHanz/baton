import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * The Working Synopsis, stored beside its work session.
 *
 * One nullable JSON column rather than a table: nothing queries into a
 * synopsis, it is always read with its work session, and it is rewritten whole
 * on every update. A side table would buy a join and nothing else.
 *
 * Additive, so an older build opens the database and ignores the column —
 * `docs/fabric/DECISIONS.md` D7.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`ALTER TABLE fabric_work_sessions ADD COLUMN synopsis_json TEXT`;

  // The fleet orders by "what needs me, then what moved most recently", and
  // the synopsis timestamp is what "recently" means once a work session stops
  // being touched by lifecycle writes.
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_fabric_work_sessions_activity
    ON fabric_work_sessions(archived_at, updated_at DESC)
  `;
});
