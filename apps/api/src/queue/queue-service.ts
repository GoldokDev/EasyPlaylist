import { createHash } from "node:crypto";

import {
  QueueMutationResponseSchema,
  QueueSnapshotSchema,
  type AddQueueItemRequest,
  type CatalogSearchResponse,
  type QueueMutationResponse,
  type QueueSnapshot,
  type RemoveQueueItemRequest,
  type ReorderQueueRequest,
} from "@easyplaylist/contracts";

interface QueryResult<Row> {
  rows: Row[];
}

export interface QueueTransactionClient {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
  release(): void;
}

export interface QueueDatabase {
  connect(): Promise<QueueTransactionClient>;
}

interface QueueServiceOptions {
  clock?: () => Date;
  database: QueueDatabase;
  isTrackAuthorized: (
    lobbyId: string,
    track: CatalogSearchResponse["results"][number],
  ) => Promise<boolean>;
}

interface LobbyQueueStateRow {
  blind_test_enabled: boolean;
  version: number | string;
}

interface LobbyQueueState {
  blindTestEnabled: boolean;
  version: number;
}

interface QueueItemRow {
  added_by_display_name: string;
  created_at: Date;
  id: string;
  normalized_track: Omit<CatalogSearchResponse["results"][number], "variants">;
  provider_variants: CatalogSearchResponse["results"][number]["variants"];
}

interface ReceiptRow {
  actor_participant_id: string;
  command_type: string;
  result: { fingerprint?: unknown };
}

type QueueConflictCode =
  | "BLIND_TEST_QUEUE_HIDDEN"
  | "IDEMPOTENCY_KEY_REUSED"
  | "QUEUE_FULL"
  | "QUEUE_ITEM_NOT_FOUND"
  | "QUEUE_ITEM_SET_CONFLICT"
  | "QUEUE_VERSION_CONFLICT"
  | "TRACK_NOT_AUTHORIZED";

export class QueueAccessError extends Error {}

export class QueueConflictError extends Error {
  constructor(
    readonly code: QueueConflictCode,
    message: string,
    readonly snapshot?: QueueSnapshot,
  ) {
    super(message);
  }
}

export class QueueService {
  private readonly clock: () => Date;

  constructor(private readonly options: QueueServiceOptions) {
    this.clock = options.clock ?? (() => new Date());
  }

  async getSnapshot(
    lobbyId: string,
    participantId: string,
  ): Promise<QueueSnapshot> {
    return this.withTransaction(async (client) => {
      const lobby = await this.lockAuthorizedLobby(
        client,
        lobbyId,
        participantId,
        "share",
      );
      return this.readSnapshot(client, lobbyId, lobby);
    });
  }

  async add(
    lobbyId: string,
    participantId: string,
    input: AddQueueItemRequest,
  ): Promise<QueueMutationResponse> {
    const fingerprint = fingerprintCommand("queue.add", {
      track: input.track,
    });

    return this.withTransaction(async (client) => {
      const lobby = await this.lockAuthorizedLobby(
        client,
        lobbyId,
        participantId,
        "update",
      );
      const replay = await this.readReplay(
        client,
        lobbyId,
        participantId,
        input.commandId,
        "queue.add",
        fingerprint,
        lobby,
      );

      if (replay) {
        return replay;
      }

      await this.requireExpectedVersion(
        client,
        lobbyId,
        lobby,
        input.expectedVersion,
      );

      if (!(await this.options.isTrackAuthorized(lobbyId, input.track))) {
        throw new QueueConflictError(
          "TRACK_NOT_AUTHORIZED",
          "The track does not come from an authorized lobby connection",
          await this.readSnapshot(client, lobbyId, lobby),
        );
      }

      const countResult = await client.query<{ item_count: number | string }>(
        `
          SELECT count(*)::integer AS item_count
          FROM queue_items
          WHERE lobby_id = $1 AND state = 'queued'
        `,
        [lobbyId],
      );

      if (Number(countResult.rows[0]?.item_count ?? 0) >= 200) {
        throw new QueueConflictError(
          "QUEUE_FULL",
          "The queue already contains the maximum number of items",
          await this.readSnapshot(client, lobbyId, lobby),
        );
      }

      const nextVersion = await this.incrementVersion(client, lobbyId);
      const positionResult = await client.query<{
        next_position: number | string;
      }>(
        `
          SELECT coalesce(max(position), 0) + 1 AS next_position
          FROM queue_items
          WHERE lobby_id = $1
        `,
        [lobbyId],
      );
      const { variants, ...normalizedTrack } = input.track;
      await client.query(
        `
          INSERT INTO queue_items (
            lobby_id,
            added_by_participant_id,
            position,
            normalized_track,
            provider_variants,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $6)
        `,
        [
          lobbyId,
          participantId,
          Number(positionResult.rows[0]?.next_position ?? 1),
          JSON.stringify(normalizedTrack),
          JSON.stringify(variants),
          this.clock(),
        ],
      );

      const snapshot = await this.readSnapshot(client, lobbyId, {
        ...lobby,
        version: nextVersion,
      });
      await this.writeReceipt(
        client,
        lobbyId,
        participantId,
        input.commandId,
        "queue.add",
        fingerprint,
        nextVersion,
      );
      return QueueMutationResponseSchema.parse({ replayed: false, snapshot });
    });
  }

  async remove(
    lobbyId: string,
    itemId: string,
    participantId: string,
    input: RemoveQueueItemRequest,
  ): Promise<QueueMutationResponse> {
    const fingerprint = fingerprintCommand("queue.remove", { itemId });

    return this.withTransaction(async (client) => {
      const lobby = await this.lockAuthorizedLobby(
        client,
        lobbyId,
        participantId,
        "update",
      );
      const replay = await this.readReplay(
        client,
        lobbyId,
        participantId,
        input.commandId,
        "queue.remove",
        fingerprint,
        lobby,
      );

      if (replay) {
        return replay;
      }

      await this.requireExpectedVersion(
        client,
        lobbyId,
        lobby,
        input.expectedVersion,
      );
      await this.requireVisibleQueue(client, lobbyId, lobby);
      const removed = await client.query<{ id: string }>(
        `
          UPDATE queue_items
          SET state = 'removed', updated_at = $3
          WHERE lobby_id = $1 AND id = $2 AND state = 'queued'
          RETURNING id
        `,
        [lobbyId, itemId, this.clock()],
      );

      if (!removed.rows[0]) {
        throw new QueueConflictError(
          "QUEUE_ITEM_NOT_FOUND",
          "The queue item is not available",
          await this.readSnapshot(client, lobbyId, lobby),
        );
      }

      const nextVersion = await this.incrementVersion(client, lobbyId);
      const snapshot = await this.readSnapshot(client, lobbyId, {
        ...lobby,
        version: nextVersion,
      });
      await this.writeReceipt(
        client,
        lobbyId,
        participantId,
        input.commandId,
        "queue.remove",
        fingerprint,
        nextVersion,
      );
      return QueueMutationResponseSchema.parse({ replayed: false, snapshot });
    });
  }

  async reorder(
    lobbyId: string,
    participantId: string,
    input: ReorderQueueRequest,
  ): Promise<QueueMutationResponse> {
    const fingerprint = fingerprintCommand("queue.reorder", {
      itemIds: input.itemIds,
    });

    return this.withTransaction(async (client) => {
      const lobby = await this.lockAuthorizedLobby(
        client,
        lobbyId,
        participantId,
        "update",
      );
      const replay = await this.readReplay(
        client,
        lobbyId,
        participantId,
        input.commandId,
        "queue.reorder",
        fingerprint,
        lobby,
      );

      if (replay) {
        return replay;
      }

      await this.requireExpectedVersion(
        client,
        lobbyId,
        lobby,
        input.expectedVersion,
      );
      await this.requireVisibleQueue(client, lobbyId, lobby);
      const currentIds = await client.query<{ id: string }>(
        `
          SELECT id
          FROM queue_items
          WHERE lobby_id = $1 AND state = 'queued'
          ORDER BY position, created_at, id
        `,
        [lobbyId],
      );

      if (
        !sameIdentifierSet(
          currentIds.rows.map(({ id }) => id),
          input.itemIds,
        )
      ) {
        throw new QueueConflictError(
          "QUEUE_ITEM_SET_CONFLICT",
          "The submitted order does not match the current queue",
          await this.readSnapshot(client, lobbyId, lobby),
        );
      }

      const nextVersion = await this.incrementVersion(client, lobbyId);
      await client.query(
        `
          UPDATE queue_items item
          SET position = ($3::bigint * 1000) + requested.position,
              updated_at = $4
          FROM unnest($2::uuid[]) WITH ORDINALITY AS requested(id, position)
          WHERE item.lobby_id = $1
            AND item.id = requested.id
            AND item.state = 'queued'
        `,
        [lobbyId, input.itemIds, nextVersion, this.clock()],
      );

      const snapshot = await this.readSnapshot(client, lobbyId, {
        ...lobby,
        version: nextVersion,
      });
      await this.writeReceipt(
        client,
        lobbyId,
        participantId,
        input.commandId,
        "queue.reorder",
        fingerprint,
        nextVersion,
      );
      return QueueMutationResponseSchema.parse({ replayed: false, snapshot });
    });
  }

  private async lockAuthorizedLobby(
    client: QueueTransactionClient,
    lobbyId: string,
    participantId: string,
    lock: "share" | "update",
  ): Promise<LobbyQueueState> {
    const result = await client.query<LobbyQueueStateRow>(
      `
        SELECT lobby.blind_test_enabled, lobby.version
        FROM lobbies lobby
        JOIN memberships membership
          ON membership.lobby_id = lobby.id
          AND membership.participant_id = $2
          AND membership.left_at IS NULL
        WHERE lobby.id = $1
          AND lobby.status = 'open'
          AND lobby.expires_at > $3
        FOR ${lock === "share" ? "SHARE" : "UPDATE"} OF lobby
      `,
      [lobbyId, participantId, this.clock()],
    );

    if (!result.rows[0]) {
      throw new QueueAccessError("Lobby queue is not available");
    }

    return {
      blindTestEnabled: result.rows[0].blind_test_enabled,
      version: Number(result.rows[0].version),
    };
  }

  private async requireExpectedVersion(
    client: QueueTransactionClient,
    lobbyId: string,
    lobby: LobbyQueueState,
    expectedVersion: number | undefined,
  ) {
    if (expectedVersion === undefined || expectedVersion === lobby.version) {
      return;
    }

    throw new QueueConflictError(
      "QUEUE_VERSION_CONFLICT",
      "The queue changed before this command was applied",
      await this.readSnapshot(client, lobbyId, lobby),
    );
  }

  private async readReplay(
    client: QueueTransactionClient,
    lobbyId: string,
    participantId: string,
    commandId: string,
    commandType: string,
    fingerprint: string,
    lobby: LobbyQueueState,
  ): Promise<QueueMutationResponse | undefined> {
    const result = await client.query<ReceiptRow>(
      `
        SELECT actor_participant_id, command_type, result
        FROM command_receipts
        WHERE lobby_id = $1 AND command_id = $2
      `,
      [lobbyId, commandId],
    );
    const receipt = result.rows[0];

    if (!receipt) {
      return undefined;
    }

    if (
      receipt.actor_participant_id !== participantId ||
      receipt.command_type !== commandType ||
      receipt.result.fingerprint !== fingerprint
    ) {
      throw new QueueConflictError(
        "IDEMPOTENCY_KEY_REUSED",
        "The command identifier was already used for another command",
        await this.readSnapshot(client, lobbyId, lobby),
      );
    }

    return QueueMutationResponseSchema.parse({
      replayed: true,
      snapshot: await this.readSnapshot(client, lobbyId, lobby),
    });
  }

  private async incrementVersion(
    client: QueueTransactionClient,
    lobbyId: string,
  ): Promise<number> {
    const result = await client.query<LobbyQueueStateRow>(
      `
        UPDATE lobbies
        SET version = version + 1, last_activity_at = $2
        WHERE id = $1
        RETURNING version
      `,
      [lobbyId, this.clock()],
    );
    const row = result.rows[0];

    if (!row) {
      throw new QueueAccessError("Lobby queue is not available");
    }

    return Number(row.version);
  }

  private async readSnapshot(
    client: QueueTransactionClient,
    lobbyId: string,
    lobby: LobbyQueueState,
  ): Promise<QueueSnapshot> {
    if (lobby.blindTestEnabled) {
      const countResult = await client.query<{ item_count: number | string }>(
        `
          SELECT count(*)::integer AS item_count
          FROM queue_items
          WHERE lobby_id = $1 AND state = 'queued'
        `,
        [lobbyId],
      );

      return QueueSnapshotSchema.parse({
        blindTestEnabled: true,
        generatedAt: this.clock().toISOString(),
        lobbyId,
        queuedCount: Number(countResult.rows[0]?.item_count ?? 0),
        version: lobby.version,
      });
    }

    const result = await client.query<QueueItemRow>(
      `
        SELECT
          item.id,
          item.normalized_track,
          item.provider_variants,
          item.created_at,
          membership.display_name AS added_by_display_name
        FROM queue_items item
        JOIN memberships membership
          ON membership.lobby_id = item.lobby_id
          AND membership.participant_id = item.added_by_participant_id
        WHERE item.lobby_id = $1 AND item.state = 'queued'
        ORDER BY item.position, item.created_at, item.id
      `,
      [lobbyId],
    );

    return QueueSnapshotSchema.parse({
      blindTestEnabled: false,
      generatedAt: this.clock().toISOString(),
      items: result.rows.map((row) => ({
        addedAt: row.created_at.toISOString(),
        addedByDisplayName: row.added_by_display_name,
        id: row.id,
        track: {
          ...row.normalized_track,
          variants: row.provider_variants,
        },
      })),
      lobbyId,
      version: lobby.version,
    });
  }

  private async requireVisibleQueue(
    client: QueueTransactionClient,
    lobbyId: string,
    lobby: LobbyQueueState,
  ) {
    if (lobby.blindTestEnabled) {
      throw new QueueConflictError(
        "BLIND_TEST_QUEUE_HIDDEN",
        "The queue cannot be managed while blind test mode is enabled",
        await this.readSnapshot(client, lobbyId, lobby),
      );
    }
  }

  private async writeReceipt(
    client: QueueTransactionClient,
    lobbyId: string,
    participantId: string,
    commandId: string,
    commandType: string,
    fingerprint: string,
    version: number,
  ) {
    const now = this.clock();
    await client.query(
      `
        INSERT INTO command_receipts (
          lobby_id,
          command_id,
          actor_participant_id,
          command_type,
          result,
          created_at,
          expires_at
        )
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
      `,
      [
        lobbyId,
        commandId,
        participantId,
        commandType,
        JSON.stringify({ fingerprint, version }),
        now,
        new Date(now.getTime() + 24 * 60 * 60 * 1_000),
      ],
    );
  }

  private async withTransaction<Result>(
    operation: (client: QueueTransactionClient) => Promise<Result>,
  ): Promise<Result> {
    const client = await this.options.database.connect();

    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

function fingerprintCommand(commandType: string, payload: unknown): string {
  return createHash("sha256")
    .update(commandType)
    .update("\0")
    .update(JSON.stringify(payload))
    .digest("hex");
}

function sameIdentifierSet(current: string[], submitted: string[]): boolean {
  if (current.length !== submitted.length) {
    return false;
  }

  const currentSet = new Set(current);
  return submitted.every((id) => currentSet.has(id));
}
