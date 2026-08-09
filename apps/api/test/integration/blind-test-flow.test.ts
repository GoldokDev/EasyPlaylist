import { Pool, type PoolClient } from "pg";
import { describe, expect, it } from "vitest";

import type { CatalogSearchResponse } from "@easyplaylist/contracts";

import { buildApp } from "../../src/app.js";
import { GuestIdentityManager } from "../../src/identity/guest-identity.js";
import { LobbyService } from "../../src/lobby/lobby-service.js";
import {
  runMigrations,
  type MigrationDatabase,
} from "../../src/persistence/migrations.js";
import {
  PlaybackService,
  type PlaybackDatabase,
} from "../../src/playback/playback-service.js";
import { ProviderCatalog } from "../../src/provider/provider-catalog.js";
import { QueueService } from "../../src/queue/queue-service.js";
import { createPostgresFixture } from "./postgres-fixture.js";

describe("blind test mode on PostgreSQL", () => {
  it("redacts metadata, keeps playback usable and rejects hidden queue management", async () => {
    const fixture = await createPostgresFixture();
    const pool = new Pool({ connectionString: fixture.databaseUrl, max: 5 });
    const serviceDatabase = schemaDatabase(pool, fixture.schema);
    const database = databaseClient(fixture.client);
    const now = new Date("2026-08-09T12:00:00.000Z");
    const providerCatalog = new ProviderCatalog();
    const lobbyService = new LobbyService({
      clock: () => now,
      database,
      generateCode: () => "AB2C3D",
    });
    const queueService = new QueueService({
      clock: () => now,
      database: serviceDatabase,
      isTrackAuthorized: (lobbyId, track) =>
        providerCatalog.isTrackAuthorizedForLobby(lobbyId, track),
    });
    const playbackService = new PlaybackService({
      clock: () => now,
      database: serviceDatabase,
      getPlaybackSource: (lobbyId, track) =>
        providerCatalog.getPlaybackSourceForLobby(lobbyId, track),
    });
    const guestIdentity = new GuestIdentityManager({
      clock: () => now,
      cookieSecure: false,
      database,
      signingKey: Buffer.from(
        "blind-test-integration-signing-key-32-bytes",
        "utf8",
      ),
    });
    const app = buildApp({
      database,
      guestIdentity,
      lobbyService,
      playbackService,
      providerCatalog,
      queueService,
    });

    try {
      await runMigrations(connectableDatabase(fixture.client));
      const created = await app.inject({
        method: "POST",
        payload: { displayName: "Camille", name: "Blind test" },
        url: "/lobbies",
      });
      const lobbyId = created.json<{ id: string }>().id;
      const creatorCookie = cookieFrom(created.headers["set-cookie"]);
      expect(created.json()).toMatchObject({
        settings: { blindTestEnabled: false },
        version: 0,
      });

      const joined = await app.inject({
        method: "POST",
        payload: { code: "AB2C3D", displayName: "Adil" },
        url: "/lobbies/join",
      });
      const memberCookie = cookieFrom(joined.headers["set-cookie"]);
      const search = await app.inject({
        headers: { cookie: memberCookie },
        method: "GET",
        url: `/lobbies/${lobbyId}/search?q=secret&limit=2`,
      });
      const tracks = search.json<CatalogSearchResponse>().results;
      expect(tracks).toHaveLength(2);

      for (const [index, track] of tracks.entries()) {
        const addition = await app.inject({
          headers: { cookie: memberCookie },
          method: "POST",
          payload: {
            commandId: `019c28d1-0000-4000-8000-00000000000${index + 1}`,
            track,
          },
          url: `/lobbies/${lobbyId}/queue/items`,
        });
        expect(addition.statusCode).toBe(201);
      }

      const visibleQueue = await app.inject({
        headers: { cookie: memberCookie },
        method: "GET",
        url: `/lobbies/${lobbyId}/queue`,
      });
      const oldQueue = visibleQueue.json<{
        items: Array<{ id: string }>;
        version: number;
      }>();
      const hiddenItemId = oldQueue.items[1]!.id;

      const creatorDevice = "019c28d2-0000-4000-8000-000000000001";
      expect(
        (
          await app.inject({
            headers: { cookie: creatorCookie },
            method: "POST",
            payload: {
              commandId: "019c28d3-0000-4000-8000-000000000001",
              deviceId: creatorDevice,
            },
            url: `/lobbies/${lobbyId}/player/claim`,
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            headers: { cookie: memberCookie },
            method: "POST",
            payload: {
              commandId: "019c28d4-0000-4000-8000-000000000001",
              deviceId: "019c28d2-0000-4000-8000-000000000002",
            },
            url: `/lobbies/${lobbyId}/playback/start`,
          })
        ).statusCode,
      ).toBe(200);

      const forbidden = await app.inject({
        headers: { cookie: memberCookie },
        method: "PATCH",
        payload: { blindTestEnabled: true },
        url: `/lobbies/${lobbyId}/settings`,
      });
      expect(forbidden.statusCode).toBe(403);

      const enabled = await app.inject({
        headers: { cookie: creatorCookie },
        method: "PATCH",
        payload: { blindTestEnabled: true },
        url: `/lobbies/${lobbyId}/settings`,
      });
      expect(enabled.statusCode).toBe(200);
      expect(enabled.json()).toMatchObject({
        settings: { blindTestEnabled: true },
      });

      const hiddenQueue = await app.inject({
        headers: { cookie: memberCookie },
        method: "GET",
        url: `/lobbies/${lobbyId}/queue`,
      });
      expect(hiddenQueue.json()).toMatchObject({
        blindTestEnabled: true,
        queuedCount: 1,
      });
      expect(hiddenQueue.body).not.toMatch(
        /secret|Adil|EasyPlaylist|fake:|items|title|artists|album|imageUrl|durationMs|providerTrackId/i,
      );

      const memberPlayer = await app.inject({
        headers: { cookie: memberCookie },
        method: "GET",
        url: `/lobbies/${lobbyId}/player?deviceId=019c28d2-0000-4000-8000-000000000002`,
      });
      expect(memberPlayer.json()).toMatchObject({
        blindTestEnabled: true,
        currentItem: { addedByDisplayName: "Adil" },
        playbackSource: null,
      });
      expect(memberPlayer.body).not.toMatch(
        /secret|EasyPlaylist|fake:|title|artists|album|imageUrl|durationMs|providerTrackId/i,
      );

      const holderPlayer = await app.inject({
        headers: { cookie: creatorCookie },
        method: "GET",
        url: `/lobbies/${lobbyId}/player?deviceId=${creatorDevice}`,
      });
      expect(holderPlayer.json()).toMatchObject({
        blindTestEnabled: true,
        currentItem: { addedByDisplayName: "Adil" },
        playbackSource: {
          provider: "fake",
          providerTrackId: expect.stringContaining("fake:"),
        },
      });
      expect(holderPlayer.body).not.toMatch(
        /"title"|"artists"|"album"|"imageUrl"|"durationMs"/,
      );

      const removal = await app.inject({
        headers: { cookie: memberCookie },
        method: "DELETE",
        payload: {
          commandId: "019c28d5-0000-4000-8000-000000000001",
          expectedVersion: enabled.json<{ version: number }>().version,
        },
        url: `/lobbies/${lobbyId}/queue/items/${hiddenItemId}`,
      });
      expect(removal.statusCode).toBe(409);
      expect(removal.json()).toMatchObject({
        code: "BLIND_TEST_QUEUE_HIDDEN",
        snapshot: { blindTestEnabled: true, queuedCount: 1 },
      });
      expect(removal.body).not.toContain(hiddenItemId);

      const reorder = await app.inject({
        headers: { cookie: memberCookie },
        method: "PUT",
        payload: {
          commandId: "019c28d5-0000-4000-8000-000000000002",
          expectedVersion: enabled.json<{ version: number }>().version,
          itemIds: oldQueue.items.map(({ id }) => id),
        },
        url: `/lobbies/${lobbyId}/queue/order`,
      });
      expect(reorder.statusCode).toBe(409);
      expect(reorder.json()).toMatchObject({
        code: "BLIND_TEST_QUEUE_HIDDEN",
        snapshot: { blindTestEnabled: true, queuedCount: 1 },
      });
      expect(reorder.body).not.toContain(hiddenItemId);

      const disabled = await app.inject({
        headers: { cookie: creatorCookie },
        method: "PATCH",
        payload: { blindTestEnabled: false },
        url: `/lobbies/${lobbyId}/settings`,
      });
      expect(disabled.statusCode).toBe(200);
      const revealedQueue = await app.inject({
        headers: { cookie: memberCookie },
        method: "GET",
        url: `/lobbies/${lobbyId}/queue`,
      });
      expect(revealedQueue.body).toContain(hiddenItemId);
      expect(revealedQueue.body).toContain("secret");
    } finally {
      await app.close();
      await pool.end();
      await fixture.cleanup();
    }
  });
});

function databaseClient(client: PoolClient) {
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

function schemaDatabase(pool: Pool, schema: string): PlaybackDatabase {
  return {
    async connect() {
      const client = await pool.connect();
      await client.query(`SET search_path TO "${schema}"`);
      return client;
    },
  };
}

function connectableDatabase(client: PoolClient): MigrationDatabase {
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
