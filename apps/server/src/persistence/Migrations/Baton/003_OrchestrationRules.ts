import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Bounded orchestration rules, and a durable record of every time one fired.
 *
 * The firings table is not a log for its own sake. "Why did this thread
 * appear?" has to stay answerable after the fact, the UI reads the last firing
 * from it, and the loop bound is enforced against a count that survives a
 * restart — an in-memory counter would reset the moment the server did, which
 * is exactly when a runaway rule would do the most damage.
 *
 * Additive, so an older build opens the database and ignores both tables —
 * `docs/fabric/DECISIONS.md` D7.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS fabric_orchestration_rules (
      id TEXT PRIMARY KEY,
      work_session_id TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT '',
      trigger_json TEXT NOT NULL,
      action_json TEXT NOT NULL,
      follow_up_json TEXT,
      status TEXT NOT NULL,
      max_firings INTEGER NOT NULL,
      fired_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_fired_at TEXT
    )
  `;

  // The reactor's hot path is "which enabled rules belong to this work
  // session", on every state change of every thread.
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_fabric_orchestration_rules_session
    ON fabric_orchestration_rules(work_session_id, status)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS fabric_orchestration_firings (
      id TEXT PRIMARY KEY,
      rule_id TEXT NOT NULL,
      work_session_id TEXT NOT NULL,
      triggered_by TEXT NOT NULL,
      outcome TEXT NOT NULL,
      produced_thread_id TEXT,
      detail TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL,
      completed_at TEXT
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_fabric_orchestration_firings_rule
    ON fabric_orchestration_firings(rule_id, started_at DESC)
  `;

  // The self-trigger check asks "did any rule on this work session produce
  // this thread?" before letting a state change fire anything.
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_fabric_orchestration_firings_produced
    ON fabric_orchestration_firings(work_session_id, produced_thread_id)
  `;
});
