import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * The last state the reactor saw a work session in.
 *
 * One row per work session, and the reason it exists is that a trigger names a
 * **transition**, not a condition. "When Claude finishes this" is about the
 * moment it finishes; a work session that sits idle for an hour has not
 * finished a hundred times. Without somewhere to remember the previous state,
 * every thread event on an idle work session re-fires every `on_done` rule
 * until its bound stops it — the bound doing the work of a schedule, which
 * `DECISIONS.md` D20 already named as the wrong shape.
 *
 * Durable rather than in memory for the same reason the firing count is: a
 * restart would otherwise re-fire everything that was already matched, and a
 * restart is exactly when a runaway does the most damage.
 *
 * Additive, so an older build opens the database and ignores the table —
 * `docs/fabric/DECISIONS.md` D7.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS fabric_work_session_observed_state (
      work_session_id TEXT PRIMARY KEY,
      state TEXT NOT NULL,
      observed_at TEXT NOT NULL
    )
  `;
});
