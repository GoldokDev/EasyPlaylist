import { randomUUID } from "node:crypto";

import { Pool, type PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";

import { buildApp } from "../../src/app.js";
import { GuestIdentityManager } from "../../src/identity/guest-identity.js";
import { LobbyLifecycleService } from "../../src/lobby/lobby-lifecycle-service.js";
import { LobbyService } from "../../src/lobby/lobby-service.js";
import {
  runMigrations,
  type MigrationDatabase,
} from "../../src/persistence/migrations.js";
import { ProviderCatalog } from "../../src/provider/provider-catalog.js";
import { QueueService } from "../../src/queue/queue-service.js";
import { createPostgresFixture } from "./postgres-fixture.js";

describe("lobby lifecycle on PostgreSQL", () => {
  it("resumes without duplication, closes atomically and purges credentials", async () => {
    const fixture = await createPostgresFixture();
    const concurrentPool = new Pool({
      connectionString: fixture.databaseUrl,
      max: 2,
    });
    const queueClient = await concurrentPool.connect();
    const closureClient = await concurrentPool.connect();
    await Promise.all([
      queueClient.query(`SET search_path TO "${fixture.schema}"`),
      closureClient.query(`SET search_path TO "${fixture.schema}"`),
    ]);
    const database = queryDatabase(fixture.client);
    const now = new Date("2026-08-08T12:00:00.000Z");
    const clock = () => now;
    const guestIdentity = new GuestIdentityManager({
      clock,
      cookieSecure: false,
      database,
      signingKey: Buffer.from("lifecycle-signing-key-with-32-bytes", "utf8"),
    });
    const lobbyService = new LobbyService({
      clock,
      database,
      generateCode: () => "KC2F3G",
    });
    const lifecycleService = new LobbyLifecycleService({
      clock,
      database: queryDatabase(closureClient),
    });
    const providerCatalog = new ProviderCatalog();
    const purgeLobby = vi.spyOn(providerCatalog, "purgeLobby");
    const queueService = new QueueService({
      clock,
      database: connectableClient(queueClient),
      isTrackAuthorized: (lobbyId, track) =>
        providerCatalog.isTrackAuthorizedForLobby(lobbyId, track),
    });
    const app = buildApp({
      database,
      guestIdentity,
      lobbyLifecycleService: lifecycleService,
      lobbyService,
      providerCatalog,
      queueService,
    });

    try {
      await runMigrations(connectableClient(fixture.client));

      const created = await app.inject({
        method: "POST",
        payload: { displayName: "Camille", name: "Dernier morceau" },
        url: "/lobbies",
      });
      const lobbyId = created.json<{ id: string }>().id;
      const creatorCookie = cookieFrom(created.headers["set-cookie"]);
      const joined = await app.inject({
        method: "POST",
        payload: { code: "KC2F3G", displayName: "Noor" },
        url: "/lobbies/join",
      });
      const guestCookie = cookieFrom(joined.headers["set-cookie"]);

      const resumedJoin = await app.inject({
        headers: { cookie: guestCookie },
        method: "POST",
        payload: { code: "KC2F3G", displayName: "Noor reconnecté" },
        url: "/lobbies/join",
      });
      expect(resumedJoin.statusCode).toBe(200);
      expect(resumedJoin.json()).toMatchObject({
        memberCount: 2,
        membership: { displayName: "Noor reconnecté", isCreator: false },
      });
      const membershipCount = await fixture.client.query<{ count: string }>(
        "SELECT count(*) FROM memberships WHERE lobby_id = $1",
        [lobbyId],
      );
      expect(Number(membershipCount.rows[0]?.count)).toBe(2);

      const forbiddenClose = await app.inject({
        headers: { cookie: guestCookie },
        method: "DELETE",
        url: `/lobbies/${lobbyId}`,
      });
      expect(forbiddenClose.statusCode).toBe(403);
      expect(forbiddenClose.json()).toEqual({
        code: "LOBBY_CREATOR_REQUIRED",
        message: "Only the lobby creator can close it",
      });

      const search = await app.inject({
        headers: { cookie: guestCookie },
        method: "GET",
        url: `/lobbies/${lobbyId}/search?q=closing&limit=1`,
      });
      const track = search.json<{ results: unknown[] }>().results[0];
      const creator = await fixture.client.query<{ participant_id: string }>(
        `
          SELECT participant_id
          FROM memberships
          WHERE lobby_id = $1 AND is_creator = true
        `,
        [lobbyId],
      );
      await fixture.client.query(
        `
          INSERT INTO provider_connections (
            lobby_id,
            owner_participant_id,
            provider,
            consented_for_lobby,
            encrypted_credentials
          ) VALUES ($1, $2, 'spotify', true, $3)
        `,
        [
          lobbyId,
          creator.rows[0]!.participant_id,
          {
            authTag: "test-auth-tag",
            ciphertext: "test-ciphertext",
            iv: "test-iv",
            keyVersion: 1,
          },
        ],
      );
      await fixture.client.query(
        `
          INSERT INTO playback_leases (
            lobby_id,
            holder_participant_id,
            device_id,
            generation,
            heartbeat_at,
            expires_at
          ) VALUES ($1, $2, $3, 1, $4, $5)
        `,
        [
          lobbyId,
          creator.rows[0]!.participant_id,
          randomUUID(),
          now,
          new Date(now.getTime() + 6_000),
        ],
      );

      const [closeResponse, racingAction] = await Promise.all([
        app.inject({
          headers: { cookie: creatorCookie },
          method: "DELETE",
          url: `/lobbies/${lobbyId}`,
        }),
        app.inject({
          headers: { cookie: guestCookie },
          method: "POST",
          payload: { commandId: randomUUID(), track },
          url: `/lobbies/${lobbyId}/queue/items`,
        }),
      ]);
      expect(closeResponse.statusCode).toBe(200);
      expect(closeResponse.json()).toMatchObject({
        id: lobbyId,
        status: "closed",
      });
      expect([201, 404]).toContain(racingAction.statusCode);
      expect(purgeLobby).toHaveBeenCalledWith(lobbyId);

      const closedState = await fixture.client.query<{
        connection_count: string;
        lease_count: string;
        status: string;
      }>(
        `
          SELECT
            lobby.status,
            (SELECT count(*) FROM provider_connections WHERE lobby_id = lobby.id) AS connection_count,
            (SELECT count(*) FROM playback_leases WHERE lobby_id = lobby.id) AS lease_count
          FROM lobbies lobby
          WHERE lobby.id = $1
        `,
        [lobbyId],
      );
      expect(closedState.rows[0]).toEqual({
        connection_count: "0",
        lease_count: "0",
        status: "closed",
      });

      const actionAfterClose = await app.inject({
        headers: { cookie: guestCookie },
        method: "POST",
        payload: { commandId: randomUUID(), track },
        url: `/lobbies/${lobbyId}/queue/items`,
      });
      expect(actionAfterClose.statusCode).toBe(404);
      const joinAfterClose = await app.inject({
        method: "POST",
        payload: { code: "KC2F3G", displayName: "Alex" },
        url: "/lobbies/join",
      });
      expect(joinAfterClose.statusCode).toBe(404);
    } finally {
      await app.close();
      queueClient.release();
      closureClient.release();
      await concurrentPool.end();
      await fixture.cleanup();
    }
  });

  it("expires a bounded batch and can replay the purge without damage", async () => {
    const fixture = await createPostgresFixture();
    const now = new Date("2026-08-10T12:00:00.000Z");

    try {
      await runMigrations(connectableClient(fixture.client));
      const participantId = randomUUID();
      const lobbyId = randomUUID();
      await fixture.client.query(
        "INSERT INTO participants (id, created_at, last_seen_at) VALUES ($1, $2, $2)",
        [participantId, new Date("2026-08-09T10:00:00.000Z")],
      );
      await fixture.client.query(
        `
          INSERT INTO lobbies (
            id, name, code, created_at, expires_at, last_activity_at
          ) VALUES ($1, 'Expired lobby', 'XP2R3D', $2, $3, $2)
        `,
        [
          lobbyId,
          new Date("2026-08-09T10:00:00.000Z"),
          new Date("2026-08-10T10:00:00.000Z"),
        ],
      );
      await fixture.client.query(
        `
          INSERT INTO memberships (
            lobby_id, participant_id, display_name, is_creator, joined_at
          ) VALUES ($1, $2, 'Camille', true, $3)
        `,
        [lobbyId, participantId, new Date("2026-08-09T10:00:00.000Z")],
      );
      await fixture.client.query(
        `
          INSERT INTO provider_connections (
            lobby_id, owner_participant_id, provider, encrypted_credentials
          ) VALUES ($1, $2, 'spotify', $3)
        `,
        [
          lobbyId,
          participantId,
          {
            authTag: "test-auth-tag",
            ciphertext: "test-ciphertext",
            iv: "test-iv",
            keyVersion: 1,
          },
        ],
      );
      const lifecycle = new LobbyLifecycleService({
        clock: () => now,
        database: queryDatabase(fixture.client),
      });

      await expect(lifecycle.expireBatch(1)).resolves.toEqual({
        expiredLobbyIds: [lobbyId],
        processedCount: 1,
        purgedConnectionCount: 1,
      });
      await expect(lifecycle.expireBatch(1)).resolves.toEqual({
        expiredLobbyIds: [],
        processedCount: 0,
        purgedConnectionCount: 0,
      });
      const state = await fixture.client.query<{
        connection_count: string;
        status: string;
      }>(
        `
          SELECT
            lobby.status,
            (SELECT count(*) FROM provider_connections WHERE lobby_id = lobby.id) AS connection_count
          FROM lobbies lobby
          WHERE lobby.id = $1
        `,
        [lobbyId],
      );
      expect(state.rows[0]).toEqual({
        connection_count: "0",
        status: "expired",
      });
      await expect(lifecycle.expireBatch(0)).rejects.toBeInstanceOf(RangeError);
    } finally {
      await fixture.cleanup();
    }
  });
});

function queryDatabase(client: PoolClient) {
  return {
    async end() {},
    async query<Row = Record<string, unknown>>(
      text: string,
      values?: readonly unknown[],
    ) {
      const result = await client.query(text, values as unknown[]);
      return { rows: result.rows as Row[] };
    },
  };
}

function connectableClient(client: PoolClient): MigrationDatabase {
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

function cookieFrom(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;

  if (!value) {
    throw new Error("Expected a set-cookie header");
  }

  return value.split(";", 1)[0] ?? "";
}
