import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Sessions Fabric adopted rather than started (§9).
 *
 * They are persisted for the same reason work sessions are: the terminal
 * somebody attached last week is still the terminal that piece of work is
 * happening in, and a restart must not lose the fact that it belongs to it. The
 * *state* is not durable in any meaningful sense — it is whatever the runtime
 * last said — but which pane belongs to which work is.
 *
 * `detached_at` rather than a delete, so a work session's history still shows
 * that a terminal was once part of it. Same choice as the provider-session
 * timeline in migration 054.
 *
 * Additive, so an older build opens the database and ignores the table —
 * `docs/fabric/DECISIONS.md` D7.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS fabric_adopted_sessions (
      id TEXT PRIMARY KEY,
      runtime TEXT NOT NULL,
      work_session_id TEXT,
      label TEXT NOT NULL,
      workspace TEXT NOT NULL,
      pane TEXT NOT NULL,
      host TEXT,
      agent_kind TEXT,
      state TEXT NOT NULL,
      capabilities_json TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      detached_at TEXT
    )
  `;

  // The fleet's question: which adopted sessions belong to this work, and are
  // any of them still attached.
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_fabric_adopted_sessions_work
    ON fabric_adopted_sessions(work_session_id, detached_at)
  `;
});
