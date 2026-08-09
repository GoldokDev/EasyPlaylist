import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";

import {
  runMigrations,
  type MigrationDatabase,
} from "../../src/persistence/migrations.js";
import { createPostgresFixture } from "./postgres-fixture.js";

function migrationDatabase(client: PoolClient): MigrationDatabase {
  return {
    async connect() {
      return {
        async query<Row = Record<string, unknown>>(
          text: string,
          values?: readonly unknown[],
        ) {
          const result = await client.query(text, values as unknown[]);

          return { rows: result.rows as Row[] };
        },
        release() {},
      };
    },
  };
}

describe("persistence foundation", () => {
  it("migrates a blank schema and enforces lobby isolation", async () => {
    const fixture = await createPostgresFixture();

    try {
      const database = migrationDatabase(fixture.client);
      expect(await runMigrations(database)).toEqual([
        "001_initial_foundation.sql",
        "002_lobby_activity.sql",
        "003_playback_coordination.sql",
        "004_blind_test_mode.sql",
      ]);
      expect(await runMigrations(database)).toEqual([]);

      const tables = await fixture.client.query<{ table_name: string }>(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = current_schema()
        ORDER BY table_name
      `);
      expect(tables.rows.map((row) => row.table_name)).toEqual([
        "command_receipts",
        "lobbies",
        "memberships",
        "participants",
        "playback_leases",
        "playback_states",
        "provider_connections",
        "queue_items",
        "schema_migrations",
      ]);

      const lobbyA = "019c28ce-66d7-4733-a38c-f7aefb572429";
      const lobbyB = "019c28cf-4167-464d-88c1-aefbedb2420d";
      const participantA = "019c28d0-2836-49af-a91a-cbaab9fd69ce";
      const participantB = "019c28d0-e238-4fd8-9fe5-17782db366a7";
      await fixture.client.query(
        "INSERT INTO participants (id) VALUES ($1), ($2)",
        [participantA, participantB],
      );
      await fixture.client.query(
        "INSERT INTO lobbies (id, name, code) VALUES ($1, 'Alpha', 'A23456'), ($2, 'Beta', 'B23456')",
        [lobbyA, lobbyB],
      );
      await fixture.client.query(
        `
          INSERT INTO memberships (lobby_id, participant_id, display_name, is_creator)
          VALUES ($1, $2, 'Same nickname', true), ($3, $4, 'Same nickname', true)
        `,
        [lobbyA, participantA, lobbyB, participantB],
      );

      await expect(
        fixture.client.query(
          `
            INSERT INTO queue_items (
              lobby_id, added_by_participant_id, position, normalized_track
            ) VALUES ($1, $2, 1, '{}')
          `,
          [lobbyA, participantB],
        ),
      ).rejects.toMatchObject({ code: "23503" });
      await expect(
        fixture.client.query(
          `
            INSERT INTO provider_connections (
              lobby_id, owner_participant_id, provider, encrypted_credentials
            ) VALUES ($1, $2, 'spotify', $3)
          `,
          [
            lobbyA,
            participantB,
            {
              authTag: "tag",
              ciphertext: "ciphertext",
              iv: "iv",
              keyVersion: 1,
            },
          ],
        ),
      ).rejects.toMatchObject({ code: "23503" });

      const expiration = await fixture.client.query<{ hours: string }>(`
        SELECT EXTRACT(EPOCH FROM (expires_at - created_at)) / 3600 AS hours
        FROM lobbies
        WHERE id = '${lobbyA}'
      `);
      expect(Number(expiration.rows[0]?.hours)).toBeCloseTo(24, 6);
      const blindTestSetting = await fixture.client.query<{
        blind_test_enabled: boolean;
      }>("SELECT blind_test_enabled FROM lobbies WHERE id = $1", [lobbyA]);
      expect(blindTestSetting.rows).toEqual([{ blind_test_enabled: false }]);
    } finally {
      await fixture.cleanup();
    }
  });

  it("upgrades an existing v1 schema without losing lobby data", async () => {
    const fixture = await createPostgresFixture();

    try {
      const database = migrationDatabase(fixture.client);
      await runMigrations(database, { through: "001_initial_foundation.sql" });
      await fixture.client.query(
        "INSERT INTO lobbies (name, code) VALUES ('Upgrade lobby', 'U23456')",
      );

      expect(await runMigrations(database)).toEqual([
        "002_lobby_activity.sql",
        "003_playback_coordination.sql",
        "004_blind_test_mode.sql",
      ]);
      const lobby = await fixture.client.query<{
        created_at: Date;
        blind_test_enabled: boolean;
        last_activity_at: Date;
        name: string;
      }>(
        "SELECT name, created_at, last_activity_at, blind_test_enabled FROM lobbies WHERE code = 'U23456'",
      );

      expect(lobby.rows[0]?.name).toBe("Upgrade lobby");
      expect(lobby.rows[0]?.last_activity_at.toISOString()).toBe(
        lobby.rows[0]?.created_at.toISOString(),
      );
      expect(lobby.rows[0]?.blind_test_enabled).toBe(false);
    } finally {
      await fixture.cleanup();
    }
  });
});
