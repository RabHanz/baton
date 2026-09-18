/**
 * The number-space split, proven on a real SQLite database rather than asserted.
 *
 * Four things have to hold, and the third is the one that would otherwise be
 * discovered by a user whose schema silently stopped matching their build:
 *
 * 1. Fabric's migrations record themselves in `fabric_sql_migrations`, not in
 *    upstream's table.
 * 2. A database migrated by an earlier build of this fork — Fabric's tables
 *    present, rows 54-59 sitting in upstream's table — is repaired in place,
 *    without re-running anything and without losing a row.
 * 3. After that repair, an upstream migration numbered 054 **runs**. Before the
 *    split it would have been skipped forever, because the migrator runs only
 *    ids above the highest recorded one.
 * 4. A half-migrated database adopts what it applied and runs the rest.
 */
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Migrator from "effect/unstable/sql/Migrator";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import {
  FABRIC_MIGRATIONS_TABLE,
  fabricMigrationManifest,
  reclaimUpstreamMigrationIds,
  runFabricMigrations,
} from "./FabricMigrations.ts";
import { runMigrations } from "./Migrations.ts";

/**
 * A database per case, rather than one for the block. These cases deliberately
 * put a database into a half-repaired state, and a shared in-memory client
 * carries that state into the next case — which is how the first draft passed
 * the repair and then failed two unrelated cases after it.
 */
const freshDatabase = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
  Effect.provide(effect, NodeSqliteClient.layerMemory());

/** The ids and names an earlier build of this fork wrote into upstream's table. */
const LEGACY_ROWS = [
  [54, "FabricWorkSessions"],
  [55, "FabricWorkSessionSynopsis"],
  [56, "FabricOrchestrationRules"],
  [57, "FabricIntents"],
  [58, "FabricWorkSessionObservedState"],
  [59, "FabricAdoptedSessions"],
] as const;

const latestUpstreamId = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{
    readonly id: number | null;
  }>`SELECT MAX(migration_id) AS id FROM effect_sql_migrations`.withoutTransform;
  return rows[0]?.id ?? 0;
});

const tableExists = (name: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${name}`
      .withoutTransform;
    return rows.length > 0;
  });

/** Put the database back into the shape an earlier build of this fork left. */
const pretendLegacyNumbering = (names: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`DROP TABLE ${sql(FABRIC_MIGRATIONS_TABLE)}`.withoutTransform;
    for (const [id, name] of LEGACY_ROWS) {
      if (!names.includes(name)) continue;
      yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (${id}, ${name})`
        .withoutTransform;
    }
  });

describe("Fabric migrations own their number space", () => {
  it.effect("record themselves in Fabric's table, leaving upstream's untouched", () =>
    freshDatabase(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        yield* runMigrations();
        const upstreamLatest = yield* latestUpstreamId;

        yield* runFabricMigrations();

        const fabricRows = yield* sql<{
          readonly migration_id: number;
          readonly name: string;
        }>`SELECT migration_id, name FROM ${sql(FABRIC_MIGRATIONS_TABLE)} ORDER BY migration_id`
          .withoutTransform;

        assert.deepStrictEqual(
          fabricRows.map((row) => [row.migration_id, row.name]),
          fabricMigrationManifest.map(([id, name]) => [id, name]),
        );
        // Upstream's high-water mark did not move, which is the whole point.
        assert.strictEqual(yield* latestUpstreamId, upstreamLatest);
        assert.ok(yield* tableExists("fabric_work_sessions"));
      }),
    ),
  );

  it.effect("repairs a database that still carries the old 054-059 rows", () =>
    freshDatabase(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        yield* runMigrations();
        const upstreamLatest = yield* latestUpstreamId;
        // Exactly the state an earlier build of this fork left: the six that
        // existed then, and no more. Running the whole manifest here would
        // simulate a database that cannot exist — one that applied migrations
        // added *after* the old numbering while still carrying it.
        yield* runFabricMigrations({ toMigrationInclusive: LEGACY_ROWS.length });
        yield* pretendLegacyNumbering(LEGACY_ROWS.map(([, name]) => name));
        // A row of real data, so "the repair kept the tables" is not a claim
        // about empty ones.
        yield* sql`
          INSERT INTO fabric_work_sessions
            (id, project_id, title, risk_class, priority, created_at, updated_at)
          VALUES ('ws-1', 'p-1', 'Survives the repair', 'R1', 'normal', '2026-09-18T00:00:00Z', '2026-09-18T00:00:00Z')
        `.withoutTransform;

        assert.strictEqual(yield* latestUpstreamId, 59);

        const reclaimed = yield* reclaimUpstreamMigrationIds();
        // Nothing that was adopted re-runs: the record moved, the SQL did not.
        // Re-running is not merely wasteful — `002_WorkSessionSynopsis` adds a
        // column, and a second `ALTER TABLE ... ADD COLUMN` fails with
        // `duplicate column name`. Anything Fabric added *after* the old
        // numbering (7 and up) is genuinely pending and does run.
        const adopted = LEGACY_ROWS.length;
        assert.deepStrictEqual(
          (yield* runFabricMigrations()).map(([id]) => id),
          fabricMigrationManifest.map(([id]) => id).filter((id) => id > adopted),
        );

        assert.deepStrictEqual(
          [...reclaimed].sort((left, right) => left - right),
          [54, 55, 56, 57, 58, 59],
        );
        assert.strictEqual(yield* latestUpstreamId, upstreamLatest);

        const fabricRows = yield* sql<{
          readonly migration_id: number;
        }>`SELECT migration_id FROM ${sql(FABRIC_MIGRATIONS_TABLE)} ORDER BY migration_id`
          .withoutTransform;
        assert.deepStrictEqual(
          fabricRows.map((row) => row.migration_id),
          fabricMigrationManifest.map(([id]) => id),
        );

        const sessions = yield* sql<{
          readonly title: string;
        }>`SELECT title FROM fabric_work_sessions`.withoutTransform;
        assert.deepStrictEqual(
          sessions.map((row) => row.title),
          ["Survives the repair"],
        );
      }),
    ),
  );

  it.effect("lets an upstream migration at 054 run after the repair", () =>
    freshDatabase(
      Effect.gen(function* () {
        yield* runMigrations();
        yield* runFabricMigrations();
        yield* pretendLegacyNumbering(LEGACY_ROWS.map(([, name]) => name));

        // Stand in for whatever upstream numbers 054 next.
        const upstreamNext = Migrator.make({})({
          loader: Migrator.fromRecord({
            "54_SomethingUpstreamAdded": Effect.gen(function* () {
              const client = yield* SqlClient.SqlClient;
              yield* client`CREATE TABLE something_upstream_added (id TEXT PRIMARY KEY)`;
            }),
          }),
        });

        // Without the reclaim this is the silent failure the split exists to
        // prevent: 54 <= 59, so the migrator skips it and reports success.
        assert.deepStrictEqual(yield* upstreamNext, []);
        assert.strictEqual(yield* tableExists("something_upstream_added"), false);

        yield* reclaimUpstreamMigrationIds();

        assert.deepStrictEqual(yield* upstreamNext, [[54, "SomethingUpstreamAdded"]]);
        assert.ok(yield* tableExists("something_upstream_added"));
      }),
    ),
  );

  it.effect("adopts what a half-migrated database applied and runs the rest for real", () =>
    freshDatabase(
      Effect.gen(function* () {
        // A machine that ran an older build of this fork: the first migration
        // applied, the rest never seen.
        yield* runMigrations();
        yield* runFabricMigrations({ toMigrationInclusive: 1 });
        yield* pretendLegacyNumbering(["FabricWorkSessions"]);

        yield* reclaimUpstreamMigrationIds();
        const executed = yield* runFabricMigrations();

        // 1 was adopted, everything after it ran. Had 1 re-run instead, the
        // column it adds would have collided and the boot would have failed.
        assert.deepStrictEqual(
          executed.map(([id]) => id),
          fabricMigrationManifest.map(([id]) => id).filter((id) => id > 1),
        );
        assert.ok(yield* tableExists("fabric_adopted_sessions"));
      }),
    ),
  );

  it.effect("reclaims nothing on a database that never used the old numbering", () =>
    freshDatabase(
      Effect.gen(function* () {
        yield* runMigrations();
        yield* runFabricMigrations();

        assert.deepStrictEqual(yield* reclaimUpstreamMigrationIds(), []);
      }),
    ),
  );
});
