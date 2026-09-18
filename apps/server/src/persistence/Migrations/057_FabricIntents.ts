import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Every sentence this environment was asked to act on, and what it did with it.
 *
 * Durable for the same reason a firing is: "why did that thread appear?" has to
 * stay answerable, and on a surface where the input arrives by voice the
 * follow-up question is usually "what did it think I said?". A refusal is
 * recorded as carefully as a success — a log that only keeps what worked cannot
 * show a grammar its own blind spots.
 *
 * Additive, so an older build opens the database and ignores the table —
 * `docs/fabric/DECISIONS.md` D7.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS fabric_intents (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      outcome TEXT NOT NULL,
      command_kind TEXT,
      work_session_id TEXT,
      description TEXT NOT NULL DEFAULT '',
      reply TEXT NOT NULL DEFAULT '',
      risk TEXT NOT NULL,
      refusal_reason TEXT,
      at TEXT NOT NULL
    )
  `;

  // Two reads: the whole log newest-first, and one work session's own.
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_fabric_intents_at
    ON fabric_intents(at DESC, id DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_fabric_intents_session
    ON fabric_intents(work_session_id, at DESC)
  `;
});
