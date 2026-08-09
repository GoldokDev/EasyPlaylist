import { Pool } from "pg";
import { expect, it } from "vitest";

import { createPostgresFixture } from "./postgres-fixture.js";

it("isolates data in a temporary schema and removes it", async () => {
  const fixture = await createPostgresFixture();
  const { databaseUrl, schema } = fixture;

  try {
    await fixture.client.query("CREATE TABLE marker (value text NOT NULL)");
    await fixture.client.query("INSERT INTO marker (value) VALUES ($1)", [
      "isolated",
    ]);
    const result = await fixture.client.query<{ value: string }>(
      "SELECT value FROM marker",
    );

    expect(result.rows).toEqual([{ value: "isolated" }]);
  } finally {
    await fixture.cleanup();
  }

  const verificationPool = new Pool({ connectionString: databaseUrl });

  try {
    const result = await verificationPool.query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM pg_namespace WHERE nspname = $1",
      [schema],
    );

    expect(result.rows).toEqual([{ count: "0" }]);
  } finally {
    await verificationPool.end();
  }
});
