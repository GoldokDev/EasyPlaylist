import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

interface MigrationQueryResult<Row> {
  rows: Row[];
}

interface MigrationClient {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<MigrationQueryResult<Row>>;
  release(): void;
}

export interface MigrationDatabase {
  connect(): Promise<MigrationClient>;
}

interface RunMigrationOptions {
  directory?: string;
  through?: string;
}

interface MigrationFile {
  checksum: string;
  name: string;
  sql: string;
}

const migrationFilePattern = /^\d{3}_[a-z0-9_]+\.sql$/;
const migrationLockId = 20_260_808;

export const defaultMigrationsDirectory = fileURLToPath(
  new URL("../../migrations/", import.meta.url),
);

async function loadMigrations(directory: string): Promise<MigrationFile[]> {
  const names = (await readdir(directory))
    .filter((name) => migrationFilePattern.test(name))
    .sort((left, right) => left.localeCompare(right));

  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(join(directory, name), "utf8");

      return {
        checksum: createHash("sha256").update(sql).digest("hex"),
        name,
        sql,
      };
    }),
  );
}

export async function runMigrations(
  database: MigrationDatabase,
  options: RunMigrationOptions = {},
): Promise<string[]> {
  const migrations = await loadMigrations(
    options.directory ?? defaultMigrationsDirectory,
  );
  const selectedMigrations = options.through
    ? migrations.slice(
        0,
        migrations.findIndex(
          (migration) => migration.name === options.through,
        ) + 1,
      )
    : migrations;

  if (options.through && selectedMigrations.length === 0) {
    throw new Error(`Unknown migration: ${options.through}`);
  }

  const client = await database.connect();
  const appliedNow: string[] = [];

  try {
    await client.query("SELECT pg_advisory_lock($1)", [migrationLockId]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        checksum char(64) NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const appliedResult = await client.query<{
      checksum: string;
      name: string;
    }>("SELECT name, checksum FROM schema_migrations ORDER BY name");
    const applied = new Map(
      appliedResult.rows.map((migration) => [
        migration.name,
        migration.checksum.trim(),
      ]),
    );

    for (const migration of selectedMigrations) {
      const previousChecksum = applied.get(migration.name);

      if (previousChecksum) {
        if (previousChecksum !== migration.checksum) {
          throw new Error(`Applied migration changed: ${migration.name}`);
        }

        continue;
      }

      await client.query("BEGIN");

      try {
        await client.query(migration.sql);
        await client.query(
          "INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)",
          [migration.name, migration.checksum],
        );
        await client.query("COMMIT");
        appliedNow.push(migration.name);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [migrationLockId]);
    client.release();
  }

  return appliedNow;
}
