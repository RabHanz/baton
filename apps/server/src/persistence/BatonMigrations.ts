/* oxlint-disable t3code/no-low-value-comments -- Baton file predating upstream's rule (D82) */
/**
 * Baton's migrations, in their own number space and their own tracking table.
 *
 * Why this is separate from `Migrations.ts`
 * ----------------------------------------
 * Upstream's manifest is a single ascending list, and the migrator runs exactly
 * the entries whose id is greater than the highest id recorded in the table —
 * anything at or below it is **silently skipped**. Baton's first six
 * migrations were numbered 054–059 inside that list, which put this fork on a
 * collision course with upstream's next migration: the moment upstream adds its
 * own 054, one of two things happens and both are bad. Merged into our
 * manifest, two entries claim the same id and the migrator fails with
 * `Duplicates`. Renumbered around ours, upstream's new migration sits below our
 * highest applied id and never runs at all — the schema silently diverges and
 * the first symptom is a query against a column that was never added.
 *
 * Putting Baton's migrations in a second manifest with `table:
 * "fabric_sql_migrations"` removes the shared number space entirely. Upstream's
 * list stays byte-identical to theirs, so the file most likely to conflict on
 * every sync stops conflicting; Baton numbers from 1 again and can add
 * migrations without caring what upstream did. Nothing in upstream's migrator
 * had to be reshaped — `MigratorOptions.table` is theirs, and it exists for
 * exactly this.
 *
 * See `docs/baton/DECISIONS.md` D48.
 */

import * as Effect from "effect/Effect";
import * as Migrator from "effect/sql/Migrator";

import Migration0001 from "./Migrations/Baton/001_WorkSessions.ts";
import Migration0002 from "./Migrations/Baton/002_WorkSessionSynopsis.ts";
import Migration0003 from "./Migrations/Baton/003_OrchestrationRules.ts";
import Migration0004 from "./Migrations/Baton/004_Intents.ts";
import Migration0005 from "./Migrations/Baton/005_WorkSessionObservedState.ts";
import Migration0006 from "./Migrations/Baton/006_AdoptedSessions.ts";
import Migration0007 from "./Migrations/Baton/007_IntentLearning.ts";

/**
 * Baton's own tracking table. Upstream's `effect_sql_migrations` is left to
 * upstream.
 */
// Legacy name (D71): live databases track Baton's migrations here; never rename it.
export const BATON_MIGRATIONS_TABLE = "fabric_sql_migrations";

const batonMigrationEntries = [
  [1, "WorkSessions", Migration0001],
  [2, "WorkSessionSynopsis", Migration0002],
  [3, "OrchestrationRules", Migration0003],
  [4, "Intents", Migration0004],
  [5, "WorkSessionObservedState", Migration0005],
  [6, "AdoptedSessions", Migration0006],
  [7, "IntentLearning", Migration0007],
] as const;

export const batonMigrationManifest = batonMigrationEntries.map(
  ([id, name]) => [id, name] as const,
);

const makeBatonMigrationLoader = (throughId?: number) =>
  Migrator.fromRecord(
    Object.fromEntries(
      batonMigrationEntries
        .filter(([id]) => throughId === undefined || id <= throughId)
        .map(([id, name, migration]) => [`${id}_${name}`, migration]),
    ),
  );

const run = Migrator.make({});

export interface RunBatonMigrationsOptions {
  readonly toMigrationInclusive?: number | undefined;
}

/**
 * Run Baton's pending migrations against `fabric_sql_migrations`.
 *
 * Called from the SQLite persistence layer after upstream's runner, so a boot
 * applies upstream's schema first and Baton's on top of it.
 */
export const runBatonMigrations = Effect.fn("runBatonMigrations")(function* ({
  toMigrationInclusive,
}: RunBatonMigrationsOptions = {}) {
  const executedMigrations = yield* run({
    loader: makeBatonMigrationLoader(toMigrationInclusive),
    table: BATON_MIGRATIONS_TABLE,
  });
  const migrations = executedMigrations.map(([id, name]) => `${id}_${name}`);
  yield* migrations.length === 0
    ? Effect.logDebug("Baton schema is current")
    : Effect.log("Baton migrations ran successfully").pipe(Effect.annotateLogs({ migrations }));
  return executedMigrations;
});
