import { Pool } from "pg";

import { runMigrations } from "./persistence/migrations.js";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://easyplaylist:local-development-only@127.0.0.1:5432/easyplaylist";
const database = new Pool({
  connectionString: databaseUrl,
  connectionTimeoutMillis: 2_000,
  max: 1,
});

try {
  const applied = await runMigrations(database);
  const summary = applied.length === 0 ? "none" : applied.join(", ");
  process.stdout.write(`Applied migrations: ${summary}\n`);
} finally {
  await database.end();
}
