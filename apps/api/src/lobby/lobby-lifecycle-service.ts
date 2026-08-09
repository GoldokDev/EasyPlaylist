import {
  CloseLobbyResponseSchema,
  type CloseLobbyResponse,
} from "@easyplaylist/contracts";

import type { LobbyDatabase } from "./lobby-service.js";

interface LobbyLifecycleServiceOptions {
  clock?: () => Date;
  database: LobbyDatabase;
}

interface CloseLobbyRow {
  closed_at: Date | null;
  id: string | null;
  is_creator: boolean;
}

interface ExpirationRow {
  lobby_id: string;
  previous_status: "closed" | "expired" | "open";
  purged_connection_count: number | string;
}

export interface LobbyExpirationResult {
  expiredLobbyIds: string[];
  processedCount: number;
  purgedConnectionCount: number;
}

export class LobbyCreatorRequiredError extends Error {}
export class LobbyLifecycleUnavailableError extends Error {}

export class LobbyLifecycleService {
  private readonly clock: () => Date;

  constructor(private readonly options: LobbyLifecycleServiceOptions) {
    this.clock = options.clock ?? (() => new Date());
  }

  async close(
    lobbyId: string,
    participantId: string,
    revokeProviders: () => Promise<void> = async () => {},
  ): Promise<CloseLobbyResponse> {
    const closed = await this.options.database.query<CloseLobbyRow>(
      `
        WITH active_membership AS (
          SELECT membership.is_creator
          FROM memberships membership
          JOIN lobbies lobby ON lobby.id = membership.lobby_id
          WHERE membership.lobby_id = $1
            AND membership.participant_id = $2
            AND membership.left_at IS NULL
            AND lobby.status = 'open'
            AND lobby.expires_at > $3
        ), closed_lobby AS (
          UPDATE lobbies lobby
          SET status = 'closed',
              closed_at = $3,
              last_activity_at = $3,
              version = version + 1
          WHERE lobby.id = $1
            AND lobby.status = 'open'
            AND lobby.expires_at > $3
            AND EXISTS (
              SELECT 1 FROM active_membership WHERE is_creator = true
            )
          RETURNING lobby.id, lobby.closed_at
        ), released_lease AS (
          DELETE FROM playback_leases lease
          USING closed_lobby
          WHERE lease.lobby_id = closed_lobby.id
        )
        SELECT
          active_membership.is_creator,
          closed_lobby.id,
          closed_lobby.closed_at
        FROM active_membership
        LEFT JOIN closed_lobby ON true
      `,
      [lobbyId, participantId, this.clock()],
    );
    const row = closed.rows[0];

    if (!row) {
      throw new LobbyLifecycleUnavailableError("Lobby cannot be closed");
    }

    if (!row.is_creator || !row.id || !row.closed_at) {
      throw new LobbyCreatorRequiredError(
        "Only the lobby creator can close it",
      );
    }

    try {
      await revokeProviders();
    } finally {
      await this.purgeConnections(row.id);
    }

    return CloseLobbyResponseSchema.parse({
      closedAt: row.closed_at.toISOString(),
      id: row.id,
      status: "closed",
    });
  }

  async expireBatch(limit = 100): Promise<LobbyExpirationResult> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
      throw new RangeError("Expiration batch size must be between 1 and 1000");
    }

    const result = await this.options.database.query<ExpirationRow>(
      `
        WITH candidates AS (
          SELECT lobby.id, lobby.status AS previous_status
          FROM lobbies lobby
          WHERE (
              lobby.status = 'open'
              AND lobby.expires_at <= $1
            ) OR (
              lobby.status IN ('closed', 'expired')
              AND EXISTS (
                SELECT 1
                FROM provider_connections connection
                WHERE connection.lobby_id = lobby.id
              )
            )
          ORDER BY lobby.expires_at, lobby.id
          LIMIT $2
          FOR UPDATE OF lobby SKIP LOCKED
        ), transitioned AS (
          UPDATE lobbies lobby
          SET status = CASE
                WHEN candidates.previous_status = 'open' THEN 'expired'
                ELSE lobby.status
              END,
              closed_at = COALESCE(lobby.closed_at, $1),
              last_activity_at = CASE
                WHEN candidates.previous_status = 'open' THEN $1
                ELSE lobby.last_activity_at
              END,
              version = CASE
                WHEN candidates.previous_status = 'open' THEN lobby.version + 1
                ELSE lobby.version
              END
          FROM candidates
          WHERE lobby.id = candidates.id
          RETURNING lobby.id, candidates.previous_status
        ), released_leases AS (
          DELETE FROM playback_leases lease
          USING transitioned
          WHERE lease.lobby_id = transitioned.id
        ), purged_connections AS (
          DELETE FROM provider_connections connection
          USING transitioned
          WHERE connection.lobby_id = transitioned.id
          RETURNING connection.lobby_id
        )
        SELECT
          transitioned.id AS lobby_id,
          transitioned.previous_status,
          count(purged_connections.lobby_id)::integer AS purged_connection_count
        FROM transitioned
        LEFT JOIN purged_connections
          ON purged_connections.lobby_id = transitioned.id
        GROUP BY transitioned.id, transitioned.previous_status
        ORDER BY transitioned.id
      `,
      [this.clock(), limit],
    );

    return {
      expiredLobbyIds: result.rows
        .filter((row) => row.previous_status === "open")
        .map((row) => row.lobby_id),
      processedCount: result.rows.length,
      purgedConnectionCount: result.rows.reduce(
        (count, row) => count + Number(row.purged_connection_count),
        0,
      ),
    };
  }

  private async purgeConnections(lobbyId: string): Promise<void> {
    await this.options.database.query(
      "DELETE FROM provider_connections WHERE lobby_id = $1",
      [lobbyId],
    );
  }
}
