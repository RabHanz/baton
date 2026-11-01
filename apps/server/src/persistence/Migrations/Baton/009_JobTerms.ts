import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** The terms of a job (D145): what it is for, what it may do, its caps and its standing grants. Additive. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS fabric_job_terms (
      work_session_id TEXT PRIMARY KEY,
      goal TEXT NOT NULL,
      permissions_json TEXT NOT NULL,
      limits_json TEXT NOT NULL,
      grants_json TEXT NOT NULL,
      phase TEXT NOT NULL DEFAULT 'drafting_plan',
      revisions_json TEXT NOT NULL DEFAULT '[]',
      schedule_task_id TEXT,
      worker_instance_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
});
