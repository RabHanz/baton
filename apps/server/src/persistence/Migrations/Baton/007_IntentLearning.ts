import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Where a resolution came from, and the sentences the user has confirmed.
 *
 * D50 put a model on the intent path behind the grammar. Two things follow that
 * the grammar-only design did not need:
 *
 *   1. **`source` and `model` on every intent.** "The grammar did this" and "a
 *      model read this and I let it" are different claims about the same row,
 *      and the difference is the first thing anybody will want when a sentence
 *      did something surprising. `source` is defaulted to `grammar`, so every
 *      row written before this migration keeps saying exactly what it meant;
 *      `model` is nullable, because only a model reading has one.
 *   2. **A table of confirmed sentence → command pairs.** The point of a model
 *      on this path is not to stay on it: a phrasing the user actually uses,
 *      resolved once and then acted on without being taken back, is a phrasing
 *      the grammar should answer instantly and identically forever after. This
 *      is that memory, consulted before the model and never instead of the
 *      grammar.
 *
 * The normalised sentence is the key rather than the raw one, so "what needs
 * me?" and "What needs me" are one entry; the raw text is kept beside it
 * because the user's own words are what a reader needs to recognise it.
 *
 * Additive, so an older build opens the database, ignores the table and reads
 * `fabric_intents` unchanged — `docs/fabric/DECISIONS.md` D7.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`ALTER TABLE fabric_intents ADD COLUMN source TEXT NOT NULL DEFAULT 'grammar'`;

  // Nullable and undefaulted: only a model reading has one, and "which model"
  // is the question a surprising row raises first.
  yield* sql`ALTER TABLE fabric_intents ADD COLUMN model TEXT`;

  yield* sql`
    CREATE TABLE IF NOT EXISTS fabric_intent_vocabulary (
      normalised_text TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      command_json TEXT NOT NULL,
      description TEXT NOT NULL,
      risk TEXT NOT NULL,
      work_session_id TEXT,
      -- Which model read it the first time, so a bad batch can be found and
      -- removed by name rather than by guesswork.
      model TEXT NOT NULL,
      learned_at TEXT NOT NULL,
      -- Bumped every time the learned entry answers a sentence. A phrasing used
      -- once and never again is noise; one used daily is vocabulary.
      used_count INTEGER NOT NULL DEFAULT 0,
      last_used_at TEXT
    )
  `;

  // The learning surface reads newest-first and the retention sweep reads by
  // age, which is the same index.
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_fabric_intent_vocabulary_learned
    ON fabric_intent_vocabulary(learned_at DESC)
  `;
});
