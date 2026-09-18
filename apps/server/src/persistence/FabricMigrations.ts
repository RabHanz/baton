/**
 * Fabric's migrations, in their own number space and their own tracking table.
 *
 * Why this is separate from `Migrations.ts`
 * ----------------------------------------
 * Upstream's manifest is a single ascending list, and the migrator runs exactly
 * the entries whose id is greater than the highest id recorded in the table —
 * anything at or below it is **silently skipped**. Fabric's first six
 * migrations were numbered 054–059 inside that list, which put this fork on a
 * collision course with upstream's next migration: the moment upstream adds its
 * own 054, one of two things happens and both are bad. Merged into our
 * manifest, two entries claim the same id and the migrator fails with
 * `Duplicates`. Renumbered around ours, upstream's new migration sits below our
 * highest applied id and never runs at all — the schema silently diverges and
 * the first symptom is a query against a column that was never added.
 *
 * Putting Fabric's migrations in a second manifest with `table:
 * "fabric_sql_migrations"` removes the shared number space entirely. Upstream's
 * list stays byte-identical to theirs, so the file most likely to conflict on
 * every sync stops conflicting; Fabric numbers from 1 again and can add
 * migrations without caring what upstream did. Nothing in upstream's migrator
 * had to be reshaped — `MigratorOptions.table` is theirs, and it exists for
 * exactly this.
 *
 * See `docs/fabric/DECISIONS.md` D48.
 */

import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Migrator from "effect/unstable/sql/Migrator";

import Migration0001 from "./Migrations/Fabric/001_WorkSessions.ts";
import Migration0002 from "./Migrations/Fabric/002_WorkSessionSynopsis.ts";
import Migration0003 from "./Migrations/Fabric/003_OrchestrationRules.ts";
import Migration0004 from "./Migrations/Fabric/004_Intents.ts";
import Migration0005 from "./Migrations/Fabric/005_WorkSessionObservedState.ts";
import Migration0006 from "./Migrations/Fabric/006_AdoptedSessions.ts";

/**
 * Fabric's own tracking table. Upstream's `effect_sql_migrations` is left to
 * upstream.
 */
export const FABRIC_MIGRATIONS_TABLE = "fabric_sql_migrations";

const fabricMigrationEntries = [
  [1, "WorkSessions", Migration0001],
  [2, "WorkSessionSynopsis", Migration0002],
  [3, "OrchestrationRules", Migration0003],
  [4, "Intents", Migration0004],
  [5, "WorkSessionObservedState", Migration0005],
  [6, "AdoptedSessions", Migration0006],
] as const;

export const fabricMigrationManifest = fabricMigrationEntries.map(
  ([id, name]) => [id, name] as const,
);

/**
 * What these migrations were called while they lived in upstream's manifest,
 * against the id they have now. Every database this fork has already touched
 * carries the left-hand names at ids 54-59.
 *
 * Matched by name rather than by id: no upstream migration is called any of
 * these, so the adoption below cannot mistake one of theirs for one of ours
 * even if upstream has since put something else at 54.
 */
const LEGACY_MIGRATION_NAMES: ReadonlyArray<readonly [legacyName: string, fabricId: number]> = [
  ["FabricWorkSessions", 1],
  ["FabricWorkSessionSynopsis", 2],
  ["FabricOrchestrationRules", 3],
  ["FabricIntents", 4],
  ["FabricWorkSessionObservedState", 5],
  ["FabricAdoptedSessions", 6],
];

const legacyNames = LEGACY_MIGRATION_NAMES.map(([name]) => name);

const makeFabricMigrationLoader = (throughId?: number) =>
  Migrator.fromRecord(
    Object.fromEntries(
      fabricMigrationEntries
        .filter(([id]) => throughId === undefined || id <= throughId)
        .map(([id, name, migration]) => [`${id}_${name}`, migration]),
    ),
  );

const run = Migrator.make({});

/**
 * Give upstream's number space back, without re-running anything.
 *
 * A database migrated by an earlier build of this fork has rows 54-59 in
 * `effect_sql_migrations`, which pins upstream's high-water mark at 59 and
 * would make upstream's own 054-059 unrunnable forever. This moves that record
 * across: each legacy row is written into Fabric's table under its new id, and
 * then deleted from upstream's, so the high-water mark drops back to upstream's
 * real latest.
 *
 * It **adopts** rather than re-runs, and that distinction is load-bearing. The
 * obvious alternative — drop the rows and let Fabric's migrator run 1-6 again
 * over tables that already exist — looks safe because the `CREATE TABLE`s say
 * `IF NOT EXISTS`, and it is not: `002_WorkSessionSynopsis` adds a column, and
 * `ALTER TABLE ... ADD COLUMN` has no `IF NOT EXISTS` in SQLite. That path
 * fails on boot with `duplicate column name: synopsis_json` on precisely the
 * machines this repair exists for. Adoption is also simply truer — those
 * migrations *did* run, and the record should say so.
 *
 * Partial states are handled the same way: a database that only ever applied
 * 54-56 adopts ids 1-3, and the migrator that follows runs 4-6 for real.
 *
 * Runs before upstream's migrator, not after: if upstream has already published
 * a 054 by the time a machine upgrades, clearing the rows first means their
 * migration runs on this boot rather than the next one.
 *
 * Returns the upstream ids it reclaimed, empty on every database that never saw
 * the old numbering.
 */
export const reclaimUpstreamMigrationIds = Effect.fn("reclaimUpstreamMigrationIds")(function* () {
  const sql = yield* SqlClient.SqlClient;

  // A fresh database has no migrations table yet, and a missing table is not a
  // failure here — it means there is nothing to reclaim.
  const legacyRows = yield* sql<{
    readonly migration_id: number;
    readonly name: string;
  }>`SELECT migration_id, name FROM effect_sql_migrations WHERE name IN ${sql.in(legacyNames)}`.withoutTransform.pipe(
    Effect.orElseSucceed(
      () => [] as ReadonlyArray<{ readonly migration_id: number; readonly name: string }>,
    ),
  );

  if (legacyRows.length === 0) return [] as ReadonlyArray<number>;

  // Same shape the migrator creates for SQLite, so the row it writes next and
  // the rows written here are indistinguishable.
  yield* sql`
    CREATE TABLE IF NOT EXISTS ${sql(FABRIC_MIGRATIONS_TABLE)} (
      migration_id integer PRIMARY KEY NOT NULL,
      created_at datetime NOT NULL DEFAULT current_timestamp,
      name VARCHAR(255) NOT NULL
    )
  `.withoutTransform;

  const alreadyAdopted = new Set(
    (yield* sql<{
      readonly migration_id: number;
    }>`SELECT migration_id FROM ${sql(FABRIC_MIGRATIONS_TABLE)}`.withoutTransform).map(
      (row) => row.migration_id,
    ),
  );

  for (const [legacyName, fabricId] of LEGACY_MIGRATION_NAMES) {
    if (alreadyAdopted.has(fabricId)) continue;
    if (!legacyRows.some((row) => row.name === legacyName)) continue;
    const name = fabricMigrationEntries.find(([id]) => id === fabricId)?.[1];
    if (name === undefined) continue;
    yield* sql`INSERT INTO ${sql(FABRIC_MIGRATIONS_TABLE)} (migration_id, name) VALUES (${fabricId}, ${name})`
      .withoutTransform;
  }

  yield* sql`DELETE FROM effect_sql_migrations WHERE name IN ${sql.in(legacyNames)}`
    .withoutTransform;

  const reclaimed = legacyRows.map((row) => row.migration_id);
  yield* Effect.log("Reclaimed upstream migration ids from Fabric's early numbering").pipe(
    Effect.annotateLogs({
      reclaimed: reclaimed.map(String),
      table: FABRIC_MIGRATIONS_TABLE,
    }),
  );
  return reclaimed;
});

export interface RunFabricMigrationsOptions {
  readonly toMigrationInclusive?: number | undefined;
}

/**
 * Run Fabric's pending migrations against `fabric_sql_migrations`.
 *
 * Called from the SQLite persistence layer after upstream's runner, so a boot
 * applies upstream's schema first and Fabric's on top of it.
 */
export const runFabricMigrations = Effect.fn("runFabricMigrations")(function* ({
  toMigrationInclusive,
}: RunFabricMigrationsOptions = {}) {
  const executedMigrations = yield* run({
    loader: makeFabricMigrationLoader(toMigrationInclusive),
    table: FABRIC_MIGRATIONS_TABLE,
  });
  const migrations = executedMigrations.map(([id, name]) => `${id}_${name}`);
  yield* migrations.length === 0
    ? Effect.logDebug("Fabric schema is current")
    : Effect.log("Fabric migrations ran successfully").pipe(Effect.annotateLogs({ migrations }));
  return executedMigrations;
});
