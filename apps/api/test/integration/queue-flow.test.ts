import { Pool, type PoolClient } from "pg";
import { describe, expect, it } from "vitest";

import type { QueueSnapshot } from "@easyplaylist/contracts";

import {
  runMigrations,
  type MigrationDatabase,
} from "../../src/persistence/migrations.js";
import {
  QueueAccessError,
  QueueConflictError,
  QueueService,
  type QueueDatabase,
} from "../../src/queue/queue-service.js";
import { createPostgresFixture } from "./postgres-fixture.js";

describe("collaborative queue on PostgreSQL", () => {
  it("serializes members, receipts and concurrent reorder conflicts", async () => {
    const fixture = await createPostgresFixture();
    const queuePool = new Pool({
      connectionString: fixture.databaseUrl,
      max: 5,
    });
    const queueDatabase = schemaDatabase(queuePool, fixture.schema);
    const queueService = new QueueService({
      clock: () => new Date("2026-08-08T12:00:00.000Z"),
      database: queueDatabase,
      isTrackAuthorized: async (lobbyId, track) =>
        track.variants.every(
          ({ connectionId }) => connectionId === `fake:${lobbyId}`,
        ),
    });
    const lobbyA = "019c28ce-66d7-4733-a38c-f7aefb572429";
    const lobbyB = "019c28cf-4167-464d-88c1-aefbedb2420d";
    const participantA = "019c28d0-2836-49af-a91a-cbaab9fd69ce";
    const participantB = "019c28d0-e238-4fd8-9fe5-17782db366a7";

    try {
      await runMigrations(connectableDatabase(fixture.client));
      await fixture.client.query(
        "INSERT INTO participants (id) VALUES ($1), ($2)",
        [participantA, participantB],
      );
      await fixture.client.query(
        `
          INSERT INTO lobbies (id, name, code, created_at, expires_at)
          VALUES
            ($1, 'Alpha', 'A23456', $3, $3::timestamptz + interval '24 hours'),
            ($2, 'Beta', 'B23456', $3, $3::timestamptz + interval '24 hours')
        `,
        [lobbyA, lobbyB, new Date("2026-08-08T10:00:00.000Z")],
      );
      await fixture.client.query(
        `
          INSERT INTO memberships (
            lobby_id, participant_id, display_name, is_creator
          ) VALUES ($1, $2, 'Camille', true), ($3, $4, 'Noor', true)
        `,
        [lobbyA, participantA, lobbyB, participantB],
      );

      const firstCommand = "019c28d1-0000-4000-8000-000000000001";
      const first = await queueService.add(lobbyA, participantA, {
        commandId: firstCommand,
        track: trackFor(lobbyA, "first", "Premier titre"),
      });
      const replay = await queueService.add(lobbyA, participantA, {
        commandId: firstCommand,
        track: trackFor(lobbyA, "first", "Premier titre"),
      });

      expect(first).toMatchObject({
        replayed: false,
        snapshot: { version: 1 },
      });
      expect(replay).toMatchObject({
        replayed: true,
        snapshot: { version: 1 },
      });
      expect(visibleQueue(replay.snapshot).items).toHaveLength(1);

      await expect(
        queueService.add(lobbyA, participantA, {
          commandId: firstCommand,
          track: trackFor(lobbyA, "different", "Autre titre"),
        }),
      ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
      await expect(
        queueService.add(lobbyA, participantA, {
          commandId: "019c28d1-0000-4000-8000-000000000002",
          track: trackFor(lobbyB, "foreign", "Titre étranger"),
        }),
      ).rejects.toMatchObject({ code: "TRACK_NOT_AUTHORIZED" });

      const concurrent = await Promise.all([
        queueService.add(lobbyA, participantA, {
          commandId: "019c28d1-0000-4000-8000-000000000003",
          track: trackFor(lobbyA, "second", "Deuxième titre"),
        }),
        queueService.add(lobbyA, participantA, {
          commandId: "019c28d1-0000-4000-8000-000000000004",
          track: trackFor(lobbyA, "third", "Troisième titre"),
        }),
      ]);
      expect(concurrent.map(({ snapshot }) => snapshot.version).sort()).toEqual(
        [2, 3],
      );

      const beforeConflict = visibleQueue(
        await queueService.getSnapshot(lobbyA, participantA),
      );
      const orderA = beforeConflict.items.map(({ id }) => id).reverse();
      const orderB = [
        ...beforeConflict.items.map(({ id }) => id).slice(1),
        beforeConflict.items[0]!.id,
      ];
      const reorderResults = await Promise.allSettled([
        queueService.reorder(lobbyA, participantA, {
          commandId: "019c28d1-0000-4000-8000-000000000005",
          expectedVersion: beforeConflict.version,
          itemIds: orderA,
        }),
        queueService.reorder(lobbyA, participantA, {
          commandId: "019c28d1-0000-4000-8000-000000000006",
          expectedVersion: beforeConflict.version,
          itemIds: orderB,
        }),
      ]);
      const fulfilled = reorderResults.filter(
        (result) => result.status === "fulfilled",
      );
      const rejected = reorderResults.filter(
        (result) => result.status === "rejected",
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
        QueueConflictError,
      );
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
        code: "QUEUE_VERSION_CONFLICT",
        snapshot: { version: 4 },
      });

      const winner = (
        fulfilled[0] as PromiseFulfilledResult<
          Awaited<ReturnType<QueueService["reorder"]>>
        >
      ).value;
      const winnerSnapshot = visibleQueue(winner.snapshot);
      const resumed = visibleQueue(
        await queueService.getSnapshot(lobbyA, participantA),
      );
      expect(resumed.items.map(({ id }) => id)).toEqual(
        winnerSnapshot.items.map(({ id }) => id),
      );

      const removed = await queueService.remove(
        lobbyA,
        resumed.items[0]!.id,
        participantA,
        {
          commandId: "019c28d1-0000-4000-8000-000000000007",
          expectedVersion: resumed.version,
        },
      );
      const removedSnapshot = visibleQueue(removed.snapshot);
      expect(removedSnapshot.items).toHaveLength(2);
      expect(removedSnapshot.version).toBe(5);
      const reorderedAfterRemoval = await queueService.reorder(
        lobbyA,
        participantA,
        {
          commandId: "019c28d1-0000-4000-8000-000000000008",
          expectedVersion: removedSnapshot.version,
          itemIds: removedSnapshot.items.map(({ id }) => id).reverse(),
        },
      );
      const reorderedSnapshot = visibleQueue(reorderedAfterRemoval.snapshot);
      expect(reorderedSnapshot.version).toBe(6);
      expect(reorderedSnapshot.items.map(({ id }) => id)).toEqual(
        removedSnapshot.items.map(({ id }) => id).reverse(),
      );

      await expect(
        queueService.getSnapshot(lobbyA, participantB),
      ).rejects.toBeInstanceOf(QueueAccessError);
      const rowCounts = await fixture.client.query<{
        item_count: string;
        receipt_count: string;
      }>(
        `
          SELECT
            (SELECT count(*) FROM queue_items WHERE lobby_id = $1) AS item_count,
            (SELECT count(*) FROM command_receipts WHERE lobby_id = $1) AS receipt_count
        `,
        [lobbyA],
      );
      expect(rowCounts.rows[0]).toEqual({
        item_count: "3",
        receipt_count: "6",
      });
    } finally {
      await queuePool.end();
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
    album: "Tests concurrents",
    artists: ["EasyPlaylist"],
    durationMs: 180_000,
    explicit: false,
    id,
    imageUrl: null,
    isrc: `TEST${id.toUpperCase()}`,
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

function schemaDatabase(pool: Pool, schema: string): QueueDatabase {
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
