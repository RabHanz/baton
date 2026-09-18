// @effect-diagnostics nodeBuiltinImport:off - this test reads the migration files as text, which is the only way to assert what their SQL does.
/**
 * D7, as a test rather than a promise.
 *
 * Fabric's rollback story is not a `down` migration — the migrator has none —
 * it is that **every Fabric migration is additive**, so a build from before it
 * opens the database, ignores what it does not know, and runs. That has been
 * rehearsed by hand after every phase. This asserts it, so the next migration
 * cannot quietly break it.
 *
 * What "additive" means here, precisely: create tables, create indexes, and add
 * columns to tables Fabric itself owns. Never drop, never rename, never alter a
 * column an older build reads.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { migrationManifest } from "./Migrations.ts";

const MIGRATIONS_DIR = NodePath.join(import.meta.dirname, "Migrations");

/** The migrations this fork added. Upstream's are upstream's business. */
const FABRIC_MIGRATIONS = migrationManifest.filter(([, name]) => name.startsWith("Fabric"));

const sourceOf = (id: number, name: string): string => {
  const file = `${String(id).padStart(3, "0")}_${name}.ts`;
  return NodeFS.readFileSync(NodePath.join(MIGRATIONS_DIR, file), "utf8");
};

/** Statements that would make a Fabric migration unsafe to roll back past. */
const FORBIDDEN: ReadonlyArray<{ readonly pattern: RegExp; readonly what: string }> = [
  { pattern: /\bDROP\s+TABLE\b/i, what: "drops a table" },
  { pattern: /\bDROP\s+COLUMN\b/i, what: "drops a column" },
  { pattern: /\bDROP\s+INDEX\b/i, what: "drops an index" },
  { pattern: /\bRENAME\s+TO\b/i, what: "renames something" },
  { pattern: /\bALTER\s+TABLE\s+\w+\s+RENAME\b/i, what: "renames a column" },
  { pattern: /\bDELETE\s+FROM\b/i, what: "deletes rows" },
  { pattern: /\bUPDATE\s+\w+\s+SET\b/i, what: "rewrites rows" },
];

describe("every Fabric migration is additive", () => {
  it("has migrations to check", () => {
    // A test that silently checks nothing is worse than no test.
    expect(FABRIC_MIGRATIONS.length).toBeGreaterThan(0);
  });

  it("never drops, renames or rewrites anything", () => {
    for (const [id, name] of FABRIC_MIGRATIONS) {
      const source = sourceOf(id, name);
      for (const rule of FORBIDDEN) {
        expect(
          rule.pattern.test(source),
          `${String(id)}_${name} ${rule.what}, which an older build cannot survive (D7)`,
        ).toBe(false);
      }
    }
  });

  it("only touches tables Fabric owns", () => {
    // An `ALTER TABLE` on an upstream table would change a shape a stock T3
    // build reads, which is the one thing D11 and D7 exist to prevent.
    for (const [id, name] of FABRIC_MIGRATIONS) {
      const source = sourceOf(id, name);
      for (const match of source.matchAll(
        /\b(?:CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?|ALTER\s+TABLE)\s+([a-z_]+)/gi,
      )) {
        const table = match[1] ?? "";
        expect(
          table.startsWith("fabric_"),
          `${String(id)}_${name} touches '${table}', which Fabric does not own`,
        ).toBe(true);
      }
    }
  });

  it("is registered in order, with no gaps or repeats", () => {
    const ids = migrationManifest.map(([id]) => id);
    expect(ids).toEqual([...ids].sort((left, right) => left - right));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
