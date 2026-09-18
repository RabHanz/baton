import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Fabric work sessions: the user's work as a durable object above provider
 * threads.
 *
 * Additive only, and deliberately so. T3's migrator has no down step, so the
 * rollback path for Fabric is "run an older build against the same database" —
 * which works because nothing here alters a table an older build reads. See
 * `docs/fabric/DECISIONS.md` D7.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Lists and arrays live in JSON columns rather than side tables because
  // nothing queries into them; the same choice the thread projection makes for
  // `snapshot_json` and `stack_json`.
  yield* sql`
    CREATE TABLE IF NOT EXISTS fabric_work_sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      objective TEXT NOT NULL DEFAULT '',
      constraints_json TEXT NOT NULL DEFAULT '[]',
      acceptance_criteria_json TEXT NOT NULL DEFAULT '[]',
      environment_affinity_json TEXT NOT NULL DEFAULT '[]',
      repository_identity_json TEXT,
      primary_worktree_path TEXT,
      base_branch TEXT,
      risk_class TEXT NOT NULL,
      priority TEXT NOT NULL,
      active_thread_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      settled_at TEXT,
      archived_at TEXT
    )
  `;

  // Status is derived from settled_at/archived_at rather than stored, so the
  // two can never disagree. The list query orders by recency within a project.
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_fabric_work_sessions_project
    ON fabric_work_sessions(project_id, updated_at DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_fabric_work_sessions_archived
    ON fabric_work_sessions(archived_at, updated_at DESC)
  `;

  // One row per stretch of work a provider thread performed. The provider
  // instance and driver are copied in at attach time and never refreshed: the
  // timeline has to keep saying "Claude A ran this from 09:10 to 10:32" after
  // the thread changed model, after the instance was renamed, and after the
  // thread itself was deleted.
  //
  // The key is a surrogate rather than (work_session_id, thread_id,
  // attached_at). A thread detached and re-attached inside the same
  // millisecond is a real sequence -- a handoff is two calls, not two seconds
  // -- and a natural key on the timestamp rejects the second one. It is also
  // what makes the timeline deterministic: rows with equal timestamps order by
  // insert.
  yield* sql`
    CREATE TABLE IF NOT EXISTS fabric_work_session_threads (
      id INTEGER PRIMARY KEY,
      work_session_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      provider_instance_id TEXT,
      provider_driver TEXT,
      role TEXT NOT NULL,
      origin TEXT NOT NULL,
      attached_at TEXT NOT NULL,
      detached_at TEXT
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_fabric_work_session_threads_session
    ON fabric_work_session_threads(work_session_id, attached_at, id)
  `;

  // A thread belongs to at most one work session at a time. Enforced here
  // rather than in the service so a concurrent attach on two connections
  // cannot produce two owners, which would make "which work session is this
  // thread part of?" unanswerable.
  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_fabric_work_session_threads_live
    ON fabric_work_session_threads(thread_id)
    WHERE detached_at IS NULL
  `;
});
