import { Pool, type PoolClient } from "pg";
import { describe, expect, it } from "vitest";

import type { QueueSnapshot } from "@easyplaylist/contracts";

import {
  PLAYER_LEASE_DURATION_MS,
  PlaybackService,
  type PlaybackDatabase,
} from "../../src/playback/playback-service.js";
import {
  runMigrations,
  type MigrationDatabase,
} from "../../src/persistence/migrations.js";
import { FakeMusicProviderAdapter } from "../../src/provider/fake-music-provider.js";
import { ProviderCatalog } from "../../src/provider/provider-catalog.js";
import { QueueService } from "../../src/queue/queue-service.js";
import { createPostgresFixture } from "./postgres-fixture.js";

describe("player lease and fake playback on PostgreSQL", () => {
  it("keeps one player, accepts member controls and advances idempotently", async () => {
    const fixture = await createPostgresFixture();
    const pool = new Pool({ connectionString: fixture.databaseUrl, max: 5 });
    const database = schemaDatabase(pool, fixture.schema);
    let now = Date.parse("2026-08-08T12:00:00.000Z");
    const providerCatalog = new ProviderCatalog({
      fakeAdapter: new FakeMusicProviderAdapter({ clock: () => now }),
    });
    const queue = new QueueService({
      clock: () => new Date(now),
      database,
      isTrackAuthorized: (lobbyId, track) =>
        providerCatalog.isTrackAuthorizedForLobby(lobbyId, track),
    });
    const playback = new PlaybackService({
      clock: () => new Date(now),
      database,
      getPlaybackSource: (lobbyId, track) =>
        providerCatalog.getPlaybackSourceForLobby(lobbyId, track),
    });
    const lobbyId = "019c28ce-66d7-4733-a38c-f7aefb572429";
    const foreignLobbyId = "019c28cf-4167-464d-88c1-aefbedb2420d";
    const camille = "019c28d0-2836-49af-a91a-cbaab9fd69ce";
    const noor = "019c28d0-e238-4fd8-9fe5-17782db366a7";
    const foreignParticipant = "019c28d1-e238-4fd8-9fe5-17782db366a7";
    const camilleDevice = "019c28d2-0000-4000-8000-000000000001";
    const noorDevice = "019c28d2-0000-4000-8000-000000000002";

    try {
      await runMigrations(connectableDatabase(fixture.client));
      await fixture.client.query(
        "INSERT INTO participants (id) VALUES ($1), ($2), ($3)",
        [camille, noor, foreignParticipant],
      );
      await fixture.client.query(
        `
          INSERT INTO lobbies (id, name, code, created_at, expires_at)
          VALUES
            ($1, 'Alpha', 'A23456', $3, $3::timestamptz + interval '24 hours'),
            ($2, 'Beta', 'B23456', $3, $3::timestamptz + interval '24 hours')
        `,
        [lobbyId, foreignLobbyId, new Date(now - 3_600_000)],
      );
      await fixture.client.query(
        `
          INSERT INTO memberships (lobby_id, participant_id, display_name, is_creator)
          VALUES
            ($1, $2, 'Camille', true),
            ($1, $3, 'Noor', false),
            ($4, $5, 'Alex', true)
        `,
        [lobbyId, camille, noor, foreignLobbyId, foreignParticipant],
      );

      for (const [index, title] of [
        "Premier",
        "Deuxième",
        "Troisième",
        "Quatrième",
      ].entries()) {
        await queue.add(lobbyId, camille, {
          commandId: `019c28d3-0000-4000-8000-00000000000${index + 1}`,
          track: trackFor(lobbyId, `track-${index + 1}`, title),
        });
      }

      const claimCommand = "019c28d4-0000-4000-8000-000000000001";
      const claimed = await playback.claim(lobbyId, camille, {
        commandId: claimCommand,
        deviceId: camilleDevice,
      });
      expect(claimed.snapshot.lease).toMatchObject({
        heldByCurrentDevice: true,
        holderDisplayName: "Camille",
        status: "held",
      });
      await expect(
        playback.claim(lobbyId, noor, {
          commandId: "019c28d4-0000-4000-8000-000000000002",
          deviceId: noorDevice,
        }),
      ).rejects.toMatchObject({ code: "LEASE_HELD" });
      await expect(
        playback.getSnapshot(lobbyId, foreignParticipant, noorDevice),
      ).rejects.toBeInstanceOf(Error);

      const startCommand = "019c28d5-0000-4000-8000-000000000001";
      const started = await playback.control(lobbyId, noor, "start", {
        commandId: startCommand,
        deviceId: noorDevice,
      });
      expect(started).toMatchObject({
        queueChanged: true,
        replayed: false,
        snapshot: {
          currentItem: { track: { title: "Premier" } },
          state: "playing",
        },
      });
      await expect(
        playback.control(lobbyId, noor, "start", {
          commandId: startCommand,
          deviceId: noorDevice,
        }),
      ).resolves.toMatchObject({ replayed: true });
      expect(
        visibleQueue(await queue.getSnapshot(lobbyId, noor)).items,
      ).toHaveLength(3);

      await expect(
        playback.control(lobbyId, noor, "pause", {
          commandId: "019c28d5-0000-4000-8000-000000000002",
          deviceId: noorDevice,
        }),
      ).resolves.toMatchObject({ snapshot: { state: "paused" } });
      await expect(
        playback.control(lobbyId, camille, "resume", {
          commandId: "019c28d5-0000-4000-8000-000000000003",
          deviceId: camilleDevice,
        }),
      ).resolves.toMatchObject({ snapshot: { state: "playing" } });

      const generation = claimed.snapshot.lease.generation!;
      const ended = await playback.report(lobbyId, camille, {
        commandId: "019c28d6-0000-4000-8000-000000000001",
        deviceId: camilleDevice,
        generation,
        outcome: "ended",
      });
      expect(ended.snapshot).toMatchObject({
        currentItem: { track: { title: "Deuxième" } },
        lastTransition: { outcome: "ended", title: "Premier" },
      });
      await expect(
        playback.report(lobbyId, noor, {
          commandId: "019c28d6-0000-4000-8000-000000000002",
          deviceId: noorDevice,
          generation,
          outcome: "ended",
        }),
      ).rejects.toMatchObject({ code: "LEASE_LOST" });

      const skipped = await playback.control(lobbyId, noor, "skip", {
        commandId: "019c28d7-0000-4000-8000-000000000001",
        deviceId: noorDevice,
      });
      expect(skipped.snapshot).toMatchObject({
        currentItem: { track: { title: "Troisième" } },
        lastTransition: { outcome: "skipped", title: "Deuxième" },
      });
      const failed = await playback.report(lobbyId, camille, {
        commandId: "019c28d8-0000-4000-8000-000000000001",
        deviceId: camilleDevice,
        generation,
        outcome: "failed",
      });
      expect(failed.snapshot).toMatchObject({
        currentItem: { track: { title: "Quatrième" } },
        lastTransition: { outcome: "failed", title: "Troisième" },
      });

      now += PLAYER_LEASE_DURATION_MS - 1_000;
      const heartbeat = await playback.heartbeat(lobbyId, camille, {
        deviceId: camilleDevice,
        generation,
      });
      expect(heartbeat.snapshot.lease.heldByCurrentDevice).toBe(true);
      now += 1_500;
      await expect(
        playback.claim(lobbyId, noor, {
          commandId: "019c28d9-0000-4000-8000-000000000001",
          deviceId: noorDevice,
        }),
      ).rejects.toMatchObject({ code: "LEASE_HELD" });
      now += PLAYER_LEASE_DURATION_MS;
      const reclaimed = await playback.claim(lobbyId, noor, {
        commandId: "019c28da-0000-4000-8000-000000000001",
        deviceId: noorDevice,
      });
      expect(reclaimed.snapshot.lease).toMatchObject({
        heldByCurrentDevice: true,
        holderDisplayName: "Noor",
      });
    } finally {
      await pool.end();
      await fixture.cleanup();
    }
  });
});

function visibleQueue(
  snapshot: QueueSnapshot,
): Extract<QueueSnapshot, { blindTestEnabled: false }> {
  if (snapshot.blindTestEnabled) {
    throw new Error("Expected a visible queue snapshot");
  }

  return snapshot;
}

function trackFor(lobbyId: string, id: string, title: string) {
  return {
    album: "Tests playback",
    artists: ["EasyPlaylist"],
    durationMs: 180_000,
    explicit: false,
    id,
    imageUrl: null,
    isrc: null,
    title,
    variants: [
      {
        connectionId: `fake:${lobbyId}`,
        playbackAvailability: "playable" as const,
        provider: "fake",
        providerTrackId: `fake:${id}`,
      },
    ],
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
