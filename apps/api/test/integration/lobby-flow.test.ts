import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";

import { buildApp } from "../../src/app.js";
import { GuestIdentityManager } from "../../src/identity/guest-identity.js";
import { LobbyService } from "../../src/lobby/lobby-service.js";
import { ProviderCatalog } from "../../src/provider/provider-catalog.js";
import {
  runMigrations,
  type MigrationDatabase,
} from "../../src/persistence/migrations.js";
import { createPostgresFixture } from "./postgres-fixture.js";

describe("lobby HTTP flow on PostgreSQL", () => {
  it("creates, joins, resumes and isolates lobbies with bounded unavailable errors", async () => {
    const fixture = await createPostgresFixture();
    const database = databaseClient(fixture.client);
    const migrationDatabase = connectableDatabase(fixture.client);
    let now = new Date("2026-08-08T12:00:00.000Z");
    const clock = () => now;
    const guestIdentity = new GuestIdentityManager({
      clock,
      cookieSecure: false,
      database,
      signingKey: Buffer.from("integration-signing-key-with-32-bytes", "utf8"),
    });
    const codes = ["AB2C3D", "BC3D4E"];
    const lobbyService = new LobbyService({
      clock,
      database,
      generateCode: () => codes.shift() ?? "CD4E5F",
    });
    const app = buildApp({
      database,
      guestIdentity,
      lobbyService,
      providerCatalog: new ProviderCatalog(),
    });

    try {
      await runMigrations(migrationDatabase);

      const created = await app.inject({
        method: "POST",
        payload: { displayName: "Camille", name: "Anniversaire" },
        url: "/lobbies",
      });
      expect(created.statusCode).toBe(201);
      expect(created.json()).toMatchObject({
        code: "AB2C3D",
        memberCount: 1,
        membership: { displayName: "Camille", isCreator: true },
        name: "Anniversaire",
      });
      const lobbyId = created.json<{ id: string }>().id;
      const creatorCookie = cookieFrom(created.headers["set-cookie"]);

      const creatorMembership = await fixture.client.query<{
        is_creator: boolean;
      }>(
        `
          SELECT is_creator
          FROM memberships
          WHERE lobby_id = $1
        `,
        [lobbyId],
      );
      expect(creatorMembership.rows).toEqual([{ is_creator: true }]);

      const joined = await app.inject({
        headers: {},
        method: "POST",
        payload: { code: "ab2c3d", displayName: "Noor" },
        url: "/lobbies/join",
      });
      expect(joined.statusCode).toBe(200);
      expect(joined.json()).toMatchObject({
        memberCount: 2,
        membership: { displayName: "Noor", isCreator: false },
      });
      const guestCookie = cookieFrom(joined.headers["set-cookie"]);

      const searched = await app.inject({
        headers: { cookie: guestCookie },
        method: "GET",
        url: `/lobbies/${lobbyId}/search?q=midnight&limit=2`,
      });
      expect(searched.statusCode).toBe(200);
      const searchPayload = searched.json<{
        issues: unknown[];
        results: Array<{
          variants: Array<{
            connectionId: string;
            playbackAvailability: string;
            provider: string;
          }>;
        }>;
      }>();
      expect(searchPayload.issues).toEqual([]);
      expect(searchPayload.results).toHaveLength(2);
      expect(searchPayload.results[0]?.variants[0]).toMatchObject({
        connectionId: `fake:${lobbyId}`,
        playbackAvailability: "playable",
        provider: "fake",
      });
      expect(searched.body).not.toMatch(
        /accessToken|refreshToken|encryptedCredentials|ciphertext|authTag/,
      );

      const invalidSearch = await app.inject({
        headers: { cookie: guestCookie },
        method: "GET",
        url: `/lobbies/${lobbyId}/search?q=x&limit=21`,
      });
      expect(invalidSearch.statusCode).toBe(400);

      const resumed = await app.inject({
        headers: { cookie: guestCookie },
        method: "GET",
        url: `/lobbies/${lobbyId}`,
      });
      expect(resumed.statusCode).toBe(200);
      expect(resumed.headers["set-cookie"]).toBeUndefined();
      expect(resumed.json()).toMatchObject({
        memberCount: 2,
        membership: { displayName: "Noor", isCreator: false },
      });

      const otherLobby = await app.inject({
        method: "POST",
        payload: { displayName: "Alex", name: "Autre soirée" },
        url: "/lobbies",
      });
      expect(otherLobby.statusCode).toBe(201);
      const otherCookie = cookieFrom(otherLobby.headers["set-cookie"]);
      const crossLobby = await app.inject({
        headers: { cookie: otherCookie },
        method: "GET",
        url: `/lobbies/${lobbyId}`,
      });
      expect(crossLobby.statusCode).toBe(404);
      expect(crossLobby.json()).toEqual({
        code: "LOBBY_NOT_FOUND",
        message: "This lobby is not available",
      });
      const crossLobbySearch = await app.inject({
        headers: { cookie: otherCookie },
        method: "GET",
        url: `/lobbies/${lobbyId}/search?q=midnight`,
      });
      expect(crossLobbySearch.statusCode).toBe(404);
      expect(crossLobbySearch.json()).toEqual({
        code: "LOBBY_NOT_FOUND",
        message: "This lobby is not available",
      });

      const unavailableBodies: unknown[] = [];
      const invalid = await app.inject({
        headers: { cookie: guestCookie },
        method: "POST",
        payload: { code: "ZZZZZZ", displayName: "Noor" },
        url: "/lobbies/join",
      });
      unavailableBodies.push(invalid.json());

      await fixture.client.query(
        "UPDATE lobbies SET status = 'closed', closed_at = $2 WHERE id = $1",
        [lobbyId, now],
      );
      const closed = await app.inject({
        headers: { cookie: creatorCookie },
        method: "POST",
        payload: { code: "AB2C3D", displayName: "Camille" },
        url: "/lobbies/join",
      });
      unavailableBodies.push(closed.json());

      await fixture.client.query(
        `
          UPDATE lobbies
          SET status = 'open', closed_at = NULL, expires_at = $2
          WHERE id = $1
        `,
        [lobbyId, new Date("2026-08-08T12:30:00.000Z")],
      );
      now = new Date("2026-08-08T13:00:00.000Z");
      const expired = await app.inject({
        headers: { cookie: creatorCookie },
        method: "POST",
        payload: { code: "AB2C3D", displayName: "Camille" },
        url: "/lobbies/join",
      });
      unavailableBodies.push(expired.json());

      expect([
        invalid.statusCode,
        closed.statusCode,
        expired.statusCode,
      ]).toEqual([404, 404, 404]);
      expect(unavailableBodies).toEqual(
        Array.from({ length: 3 }, () => ({
          code: "LOBBY_UNAVAILABLE",
          message: "This lobby cannot be joined",
        })),
      );
    } finally {
      await app.close();
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
