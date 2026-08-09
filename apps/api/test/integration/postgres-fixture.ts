import { randomUUID } from "node:crypto";

import { Pool, type PoolClient } from "pg";

export interface PostgresFixture {
  cleanup(): Promise<void>;
  client: PoolClient;
  databaseUrl: string;
  schema: string;
}

export async function createPostgresFixture(): Promise<PostgresFixture> {
  const databaseUrl = process.env.TEST_DATABASE_URL;

  if (!databaseUrl) {
    throw new Error(
      "TEST_DATABASE_URL is required for PostgreSQL integration tests",
    );
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  const schema = `test_${randomUUID().replaceAll("-", "")}`;
  await pool.query(`CREATE SCHEMA "${schema}"`);
  const client = await pool.connect();
  await client.query(`SET search_path TO "${schema}"`);
  let cleaned = false;

  return {
    client,
    databaseUrl,
    schema,
    async cleanup() {
      if (cleaned) {
        return;
      }

      cleaned = true;
      client.release();

      try {
        await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
      } finally {
        await pool.end();
      }
    },
  };
}
