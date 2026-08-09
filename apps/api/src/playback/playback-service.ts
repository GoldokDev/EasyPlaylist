import { createHash } from "node:crypto";

import {
  PlayerMutationResponseSchema,
  PlayerSnapshotSchema,
  type ClaimPlayerRequest,
  type PlaybackControlRequest,
  type PlaybackReportRequest,
  type PlayerHeartbeatRequest,
  type PlayerMutationResponse,
  type PlayerSnapshot,
  type QueueItem,
} from "@easyplaylist/contracts";

import type {
  CapabilityAwareMusicProvider,
  TrackCandidate,
} from "../provider/music-provider.js";

export const PLAYER_HEARTBEAT_INTERVAL_MS = 2_000;
export const PLAYER_LEASE_DURATION_MS = 6_000;

interface QueryResult<Row> {
  rows: Row[];
}

export interface PlaybackTransactionClient {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
  release(): void;
}

export interface PlaybackDatabase {
  connect(): Promise<PlaybackTransactionClient>;
}

interface PlaybackSource {
  candidate: TrackCandidate;
  provider: CapabilityAwareMusicProvider;
}

interface PlaybackServiceOptions {
  clock?: () => Date;
  database: PlaybackDatabase;
  getPlaybackSource: (
    lobbyId: string,
    track: QueueItem["track"],
  ) => PlaybackSource;
}

interface LeaseRow {
  device_id: string;
  expires_at: Date;
  generation: number | string;
  holder_participant_id: string;
  holder_display_name: string;
}

interface PlaybackStateRow {
  current_item_id: string | null;
  last_transition: PlayerSnapshot["lastTransition"];
  position_ms: number;
  provider_command_id: string | null;
  state: "idle" | "paused" | "playing";
  version: number | string;
}

interface QueueItemRow {
  added_by_display_name: string;
  created_at: Date;
  id: string;
  normalized_track: Omit<QueueItem["track"], "variants">;
  provider_variants: QueueItem["track"]["variants"];
}

interface ReceiptRow {
  actor_participant_id: string;
  command_type: string;
  result: { fingerprint?: unknown };
}

type PlayerConflictCode =
  | "IDEMPOTENCY_KEY_REUSED"
  | "LEASE_HELD"
  | "LEASE_LOST"
  | "PLAYBACK_COMMAND_REJECTED"
  | "QUEUE_EMPTY";

export class PlayerAccessError extends Error {}

export class PlayerConflictError extends Error {
  constructor(
    readonly code: PlayerConflictCode,
    message: string,
    readonly snapshot?: PlayerSnapshot,
  ) {
    super(message);
  }
}

export class PlaybackService {
  private readonly clock: () => Date;

  constructor(private readonly options: PlaybackServiceOptions) {
    this.clock = options.clock ?? (() => new Date());
  }

  async getSnapshot(
    lobbyId: string,
    participantId: string,
    deviceId: string,
  ): Promise<PlayerSnapshot> {
    return this.withTransaction(async (client) => {
      await this.lockAuthorizedLobby(client, lobbyId, participantId, "share");
      return this.readSnapshot(client, lobbyId, participantId, deviceId);
    });
  }

  async claim(
    lobbyId: string,
    participantId: string,
    input: ClaimPlayerRequest,
  ): Promise<PlayerMutationResponse> {
    const fingerprint = fingerprintCommand("player.claim", {
      deviceId: input.deviceId,
    });

    return this.withTransaction(async (client) => {
      await this.lockAuthorizedLobby(client, lobbyId, participantId, "update");
      const replay = await this.readReplay(
        client,
        lobbyId,
        participantId,
        input.deviceId,
        input.commandId,
        "player.claim",
        fingerprint,
      );

      if (replay) {
        return replay;
      }

      const now = this.clock();
      const current = await this.readLease(client, lobbyId, true);

      if (
        current &&
        current.expires_at > now &&
        (current.holder_participant_id !== participantId ||
          current.device_id !== input.deviceId)
      ) {
        throw new PlayerConflictError(
          "LEASE_HELD",
          "Another browser currently holds the player lease",
          await this.readSnapshot(
            client,
            lobbyId,
            participantId,
            input.deviceId,
          ),
        );
      }

      const generation = Number(current?.generation ?? 0) + 1;
      await client.query(
        `
          INSERT INTO playback_leases (
            lobby_id,
            holder_participant_id,
            device_id,
            generation,
            heartbeat_at,
            expires_at
          )
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (lobby_id) DO UPDATE SET
            holder_participant_id = EXCLUDED.holder_participant_id,
            device_id = EXCLUDED.device_id,
            generation = EXCLUDED.generation,
            heartbeat_at = EXCLUDED.heartbeat_at,
            expires_at = EXCLUDED.expires_at
        `,
        [
          lobbyId,
          participantId,
          input.deviceId,
          generation,
          now,
          new Date(now.getTime() + PLAYER_LEASE_DURATION_MS),
        ],
      );
      await this.touchLobby(client, lobbyId);
      await this.writeReceipt(
        client,
        lobbyId,
        participantId,
        input.commandId,
        "player.claim",
        fingerprint,
      );
      return PlayerMutationResponseSchema.parse({
        queueChanged: false,
        replayed: false,
        snapshot: await this.readSnapshot(
          client,
          lobbyId,
          participantId,
          input.deviceId,
        ),
      });
    });
  }

  async heartbeat(
    lobbyId: string,
    participantId: string,
    input: PlayerHeartbeatRequest,
  ): Promise<PlayerMutationResponse> {
    return this.withTransaction(async (client) => {
      await this.lockAuthorizedLobby(client, lobbyId, participantId, "update");
      const now = this.clock();
      const result = await client.query(
        `
          UPDATE playback_leases
          SET heartbeat_at = $6, expires_at = $7
          WHERE lobby_id = $1
            AND holder_participant_id = $2
            AND device_id = $3
            AND generation = $4
            AND expires_at > $5
          RETURNING lobby_id
        `,
        [
          lobbyId,
          participantId,
          input.deviceId,
          input.generation,
          now,
          now,
          new Date(now.getTime() + PLAYER_LEASE_DURATION_MS),
        ],
      );

      if (!result.rows[0]) {
        throw new PlayerConflictError(
          "LEASE_LOST",
          "The player lease expired or moved to another browser",
          await this.readSnapshot(
            client,
            lobbyId,
            participantId,
            input.deviceId,
          ),
        );
      }

      return PlayerMutationResponseSchema.parse({
        queueChanged: false,
        replayed: false,
        snapshot: await this.readSnapshot(
          client,
          lobbyId,
          participantId,
          input.deviceId,
        ),
      });
    });
  }

  async control(
    lobbyId: string,
    participantId: string,
    command: "pause" | "resume" | "skip" | "start",
    input: PlaybackControlRequest,
  ): Promise<PlayerMutationResponse> {
    const commandType = `playback.${command}`;
    const fingerprint = fingerprintCommand(commandType, {});

    return this.withTransaction(async (client) => {
      await this.lockAuthorizedLobby(client, lobbyId, participantId, "update");
      const replay = await this.readReplay(
        client,
        lobbyId,
        participantId,
        input.deviceId,
        input.commandId,
        commandType,
        fingerprint,
      );

      if (replay) {
        return replay;
      }

      await this.requireActiveLease(
        client,
        lobbyId,
        participantId,
        input.deviceId,
      );
      const state = await this.readPlaybackState(client, lobbyId, true);
      let queueChanged = false;

      if (command === "start") {
        if (state.current_item_id || state.state !== "idle") {
          throw await this.commandRejected(
            client,
            lobbyId,
            participantId,
            input.deviceId,
          );
        }

        queueChanged = await this.startNext(
          client,
          lobbyId,
          input.commandId,
          null,
        );

        if (!queueChanged) {
          throw new PlayerConflictError(
            "QUEUE_EMPTY",
            "The queue does not contain a playable title",
            await this.readSnapshot(
              client,
              lobbyId,
              participantId,
              input.deviceId,
            ),
          );
        }
      } else if (command === "pause" || command === "resume") {
        const expectedState = command === "pause" ? "playing" : "paused";

        if (
          state.state !== expectedState ||
          !state.current_item_id ||
          !state.provider_command_id
        ) {
          throw await this.commandRejected(
            client,
            lobbyId,
            participantId,
            input.deviceId,
          );
        }

        const item = await this.readQueueItem(
          client,
          lobbyId,
          state.current_item_id,
        );
        const source = this.options.getPlaybackSource(lobbyId, item.track);
        const variant = await source.provider.resolve(source.candidate);
        const report = await source.provider[command]({
          commandId: state.provider_command_id,
          variant,
        });
        await client.query(
          `
            UPDATE playback_states
            SET state = $2, position_ms = $3, version = version + 1, updated_at = $4
            WHERE lobby_id = $1
          `,
          [lobbyId, report.state, report.positionMs, this.clock()],
        );
      } else {
        if (!state.current_item_id || !state.provider_command_id) {
          throw await this.commandRejected(
            client,
            lobbyId,
            participantId,
            input.deviceId,
          );
        }

        const item = await this.readQueueItem(
          client,
          lobbyId,
          state.current_item_id,
        );
        const source = this.options.getPlaybackSource(lobbyId, item.track);
        const variant = await source.provider.resolve(source.candidate);
        await source.provider.skip({
          commandId: state.provider_command_id,
          variant,
        });
        await this.finishCurrent(client, lobbyId, item, "skipped");
        await this.startNext(
          client,
          lobbyId,
          input.commandId,
          transition(item, "skipped", this.clock()),
        );
        queueChanged = true;
      }

      if (queueChanged) {
        await this.incrementQueueVersion(client, lobbyId);
      } else {
        await this.touchLobby(client, lobbyId);
      }

      await this.writeReceipt(
        client,
        lobbyId,
        participantId,
        input.commandId,
        commandType,
        fingerprint,
      );
      return PlayerMutationResponseSchema.parse({
        queueChanged,
        replayed: false,
        snapshot: await this.readSnapshot(
          client,
          lobbyId,
          participantId,
          input.deviceId,
        ),
      });
    });
  }

  async report(
    lobbyId: string,
    participantId: string,
    input: PlaybackReportRequest,
  ): Promise<PlayerMutationResponse> {
    const commandType = `playback.report.${input.outcome}`;
    const fingerprint = fingerprintCommand(commandType, {
      generation: input.generation,
    });

    return this.withTransaction(async (client) => {
      await this.lockAuthorizedLobby(client, lobbyId, participantId, "update");
      const replay = await this.readReplay(
        client,
        lobbyId,
        participantId,
        input.deviceId,
        input.commandId,
        commandType,
        fingerprint,
      );

      if (replay) {
        return replay;
      }

      await this.requireCurrentLease(
        client,
        lobbyId,
        participantId,
        input.deviceId,
        input.generation,
      );
      const state = await this.readPlaybackState(client, lobbyId, true);

      if (!state.current_item_id) {
        throw await this.commandRejected(
          client,
          lobbyId,
          participantId,
          input.deviceId,
        );
      }

      const item = await this.readQueueItem(
        client,
        lobbyId,
        state.current_item_id,
      );
      await this.finishCurrent(client, lobbyId, item, input.outcome);
      await this.startNext(
        client,
        lobbyId,
        input.commandId,
        transition(item, input.outcome, this.clock()),
      );
      await this.incrementQueueVersion(client, lobbyId);
      await this.writeReceipt(
        client,
        lobbyId,
        participantId,
        input.commandId,
        commandType,
        fingerprint,
      );
      return PlayerMutationResponseSchema.parse({
        queueChanged: true,
        replayed: false,
        snapshot: await this.readSnapshot(
          client,
          lobbyId,
          participantId,
          input.deviceId,
        ),
      });
    });
  }

  private async startNext(
    client: PlaybackTransactionClient,
    lobbyId: string,
    providerCommandId: string,
    previousTransition: PlayerSnapshot["lastTransition"],
  ): Promise<boolean> {
    let changed = false;
    let lastTransition = previousTransition;

    while (true) {
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
          LIMIT 1
          FOR UPDATE OF item
        `,
        [lobbyId],
      );
      const row = result.rows[0];

      if (!row) {
        await client.query(
          `
            UPDATE playback_states
            SET current_item_id = NULL,
                state = 'idle',
                position_ms = 0,
                provider_command_id = NULL,
                last_transition = $2::jsonb,
                version = version + 1,
                updated_at = $3
            WHERE lobby_id = $1
          `,
          [lobbyId, serializeTransition(lastTransition), this.clock()],
        );
        return changed;
      }

      const item = mapQueueItem(row);
      changed = true;
      let report: { positionMs: number };

      try {
        const source = this.options.getPlaybackSource(lobbyId, item.track);
        const variant = await source.provider.resolve(source.candidate);
        report = await source.provider.start({
          commandId: providerCommandId,
          variant,
        });
      } catch {
        await client.query(
          `UPDATE queue_items SET state = 'failed', updated_at = $3 WHERE lobby_id = $1 AND id = $2`,
          [lobbyId, item.id, this.clock()],
        );
        lastTransition = transition(item, "failed", this.clock());
        continue;
      }

      await client.query(
        `UPDATE queue_items SET state = 'playing', updated_at = $3 WHERE lobby_id = $1 AND id = $2`,
        [lobbyId, item.id, this.clock()],
      );
      await client.query(
        `
          UPDATE playback_states
          SET current_item_id = $2,
              state = 'playing',
              position_ms = $3,
              provider_command_id = $4,
              last_transition = $5::jsonb,
              version = version + 1,
              updated_at = $6
          WHERE lobby_id = $1
        `,
        [
          lobbyId,
          item.id,
          report.positionMs,
          providerCommandId,
          serializeTransition(lastTransition),
          this.clock(),
        ],
      );
      return true;
    }
  }

  private async finishCurrent(
    client: PlaybackTransactionClient,
    lobbyId: string,
    item: QueueItem,
    outcome: "ended" | "failed" | "skipped",
  ) {
    await client.query(
      `
        UPDATE queue_items
        SET state = $3, updated_at = $4
        WHERE lobby_id = $1 AND id = $2 AND state = 'playing'
      `,
      [
        lobbyId,
        item.id,
        outcome === "failed" ? "failed" : "played",
        this.clock(),
      ],
    );
  }

  private async readSnapshot(
    client: PlaybackTransactionClient,
    lobbyId: string,
    participantId: string,
    deviceId: string,
  ): Promise<PlayerSnapshot> {
    const state = await this.readPlaybackState(client, lobbyId, false);
    const lease = await this.readLease(client, lobbyId, false);
    const now = this.clock();
    const leaseIsActive = Boolean(lease && lease.expires_at > now);

    return PlayerSnapshotSchema.parse({
      currentItem: state.current_item_id
        ? await this.readQueueItem(client, lobbyId, state.current_item_id)
        : null,
      lastTransition: state.last_transition,
      lease: {
        expiresAt: leaseIsActive ? lease?.expires_at.toISOString() : null,
        generation: leaseIsActive ? Number(lease?.generation) : null,
        heldByCurrentDevice: Boolean(
          leaseIsActive &&
          lease?.holder_participant_id === participantId &&
          lease.device_id === deviceId,
        ),
        holderDisplayName: leaseIsActive ? lease?.holder_display_name : null,
        status: leaseIsActive ? "held" : "available",
      },
      lobbyId,
      positionMs: state.position_ms,
      state: state.state,
      version: Number(state.version),
    });
  }

  private async readPlaybackState(
    client: PlaybackTransactionClient,
    lobbyId: string,
    lock: boolean,
  ): Promise<PlaybackStateRow> {
    await client.query(
      `INSERT INTO playback_states (lobby_id) VALUES ($1) ON CONFLICT (lobby_id) DO NOTHING`,
      [lobbyId],
    );
    const result = await client.query<PlaybackStateRow>(
      `
        SELECT current_item_id, last_transition, position_ms, provider_command_id, state, version
        FROM playback_states
        WHERE lobby_id = $1
        ${lock ? "FOR UPDATE" : ""}
      `,
      [lobbyId],
    );
    return result.rows[0]!;
  }

  private async readLease(
    client: PlaybackTransactionClient,
    lobbyId: string,
    lock: boolean,
  ): Promise<LeaseRow | undefined> {
    const result = await client.query<LeaseRow>(
      `
        SELECT
          lease.device_id,
          lease.expires_at,
          lease.generation,
          lease.holder_participant_id,
          membership.display_name AS holder_display_name
        FROM playback_leases lease
        JOIN memberships membership
          ON membership.lobby_id = lease.lobby_id
          AND membership.participant_id = lease.holder_participant_id
        WHERE lease.lobby_id = $1
        ${lock ? "FOR UPDATE OF lease" : ""}
      `,
      [lobbyId],
    );
    return result.rows[0];
  }

  private async readQueueItem(
    client: PlaybackTransactionClient,
    lobbyId: string,
    itemId: string,
  ): Promise<QueueItem> {
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
        WHERE item.lobby_id = $1 AND item.id = $2
      `,
      [lobbyId, itemId],
    );
    const row = result.rows[0];

    if (!row) {
      throw new Error("Playback queue item is missing");
    }

    return mapQueueItem(row);
  }

  private async requireActiveLease(
    client: PlaybackTransactionClient,
    lobbyId: string,
    participantId: string,
    deviceId: string,
  ) {
    const lease = await this.readLease(client, lobbyId, true);

    if (!lease || lease.expires_at <= this.clock()) {
      throw new PlayerConflictError(
        "LEASE_LOST",
        "No browser currently holds the player lease",
        await this.readSnapshot(client, lobbyId, participantId, deviceId),
      );
    }
  }

  private async requireCurrentLease(
    client: PlaybackTransactionClient,
    lobbyId: string,
    participantId: string,
    deviceId: string,
    generation: number,
  ) {
    const lease = await this.readLease(client, lobbyId, true);

    if (
      !lease ||
      lease.expires_at <= this.clock() ||
      lease.holder_participant_id !== participantId ||
      lease.device_id !== deviceId ||
      Number(lease.generation) !== generation
    ) {
      throw new PlayerConflictError(
        "LEASE_LOST",
        "Only the current player browser can report playback",
        await this.readSnapshot(client, lobbyId, participantId, deviceId),
      );
    }
  }

  private async lockAuthorizedLobby(
    client: PlaybackTransactionClient,
    lobbyId: string,
    participantId: string,
    lock: "share" | "update",
  ) {
    const result = await client.query(
      `
        SELECT lobby.id
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
      throw new PlayerAccessError("Lobby player is not available");
    }
  }

  private async readReplay(
    client: PlaybackTransactionClient,
    lobbyId: string,
    participantId: string,
    deviceId: string,
    commandId: string,
    commandType: string,
    fingerprint: string,
  ): Promise<PlayerMutationResponse | undefined> {
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
      throw new PlayerConflictError(
        "IDEMPOTENCY_KEY_REUSED",
        "The command identifier was already used for another command",
        await this.readSnapshot(client, lobbyId, participantId, deviceId),
      );
    }

    return PlayerMutationResponseSchema.parse({
      queueChanged: false,
      replayed: true,
      snapshot: await this.readSnapshot(
        client,
        lobbyId,
        participantId,
        deviceId,
      ),
    });
  }

  private async writeReceipt(
    client: PlaybackTransactionClient,
    lobbyId: string,
    participantId: string,
    commandId: string,
    commandType: string,
    fingerprint: string,
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
        JSON.stringify({ fingerprint }),
        now,
        new Date(now.getTime() + 24 * 60 * 60 * 1_000),
      ],
    );
  }

  private async incrementQueueVersion(
    client: PlaybackTransactionClient,
    lobbyId: string,
  ) {
    await client.query(
      `UPDATE lobbies SET version = version + 1, last_activity_at = $2 WHERE id = $1`,
      [lobbyId, this.clock()],
    );
  }

  private async touchLobby(client: PlaybackTransactionClient, lobbyId: string) {
    await client.query(
      `UPDATE lobbies SET last_activity_at = $2 WHERE id = $1`,
      [lobbyId, this.clock()],
    );
  }

  private async commandRejected(
    client: PlaybackTransactionClient,
    lobbyId: string,
    participantId: string,
    deviceId: string,
  ) {
    return new PlayerConflictError(
      "PLAYBACK_COMMAND_REJECTED",
      "The command does not match the current playback state",
      await this.readSnapshot(client, lobbyId, participantId, deviceId),
    );
  }

  private async withTransaction<Result>(
    operation: (client: PlaybackTransactionClient) => Promise<Result>,
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

function mapQueueItem(row: QueueItemRow): QueueItem {
  return {
    addedAt: row.created_at.toISOString(),
    addedByDisplayName: row.added_by_display_name,
    id: row.id,
    track: {
      ...row.normalized_track,
      variants: row.provider_variants,
    },
  };
}

function transition(
  item: QueueItem,
  outcome: "ended" | "failed" | "skipped",
  at: Date,
): NonNullable<PlayerSnapshot["lastTransition"]> {
  return { at: at.toISOString(), outcome, title: item.track.title };
}

function serializeTransition(
  value: PlayerSnapshot["lastTransition"],
): string | null {
  return value ? JSON.stringify(value) : null;
}

function fingerprintCommand(commandType: string, payload: unknown): string {
  return createHash("sha256")
    .update(commandType)
    .update("\0")
    .update(JSON.stringify(payload))
    .digest("hex");
}
