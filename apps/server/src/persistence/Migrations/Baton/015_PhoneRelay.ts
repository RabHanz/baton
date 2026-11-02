import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * The phone-to-desktop relay: what the phone page asked the desktop assistant (kept until answered or expired), and the
 * questions the desktop mirrored to the phone while they wait. Additive.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS fabric_phone_asks (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'phone',
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      taken_at INTEGER,
      answered_at INTEGER,
      spoken TEXT,
      card TEXT,
      error TEXT
    )
  `;
  yield* sql`CREATE INDEX IF NOT EXISTS fabric_phone_asks_status ON fabric_phone_asks (status, created_at)`;
  yield* sql`
    CREATE TABLE IF NOT EXISTS fabric_phone_prompts (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      detail TEXT NOT NULL,
      buttons TEXT NOT NULL,
      yes INTEGER NOT NULL,
      cancel INTEGER NOT NULL,
      status TEXT NOT NULL,
      answer INTEGER,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `;
});
