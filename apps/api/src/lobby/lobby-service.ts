import { randomInt } from "node:crypto";

import {
  LobbyResponseSchema,
  type LobbyResponse,
  type UpdateLobbySettingsRequest,
} from "@easyplaylist/contracts";

interface LobbyQueryResult<Row> {
  rows: Row[];
}

export interface LobbyDatabase {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<LobbyQueryResult<Row>>;
}

interface LobbyServiceOptions {
  clock?: () => Date;
  database: LobbyDatabase;
  generateCode?: () => string;
  ttlHours?: number;
}

interface LobbyRow {
  blind_test_enabled: boolean;
  code: string;
  created_at: Date;
  display_name: string;
  expires_at: Date;
  id: string;
  is_creator: boolean;
  joined_at: Date;
  member_count: number | string;
  name: string;
  status: "open";
  version: number | string;
}

interface CreateLobbyInput {
  displayName: string;
  name: string;
  participantId: string;
}

interface JoinLobbyInput {
  code: string;
  displayName: string;
  participantId: string;
}

export interface LobbySettingsUpdateResult {
  changed: boolean;
  lobby: LobbyResponse;
}

export class LobbyUnavailableError extends Error {}
export class LobbySettingsCreatorRequiredError extends Error {}

export class LobbyService {
  private readonly clock: () => Date;
  private readonly generateCode: () => string;
  private readonly ttlHours: number;

  constructor(private readonly options: LobbyServiceOptions) {
    this.clock = options.clock ?? (() => new Date());
    this.generateCode = options.generateCode ?? generateLobbyCode;
    this.ttlHours = options.ttlHours ?? 24;

    if (!Number.isInteger(this.ttlHours) || this.ttlHours < 1) {
      throw new RangeError(
        "Lobby TTL must be a positive whole number of hours",
      );
    }
  }

  async create(input: CreateLobbyInput): Promise<LobbyResponse> {
    const now = this.clock();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const result = await this.options.database.query<LobbyRow>(
          `
            WITH created_lobby AS (
              INSERT INTO lobbies (name, code, created_at, expires_at, last_activity_at)
              VALUES (
                $1,
                $2,
                $3::timestamptz,
                $3::timestamptz + make_interval(hours => $6::integer),
                $3::timestamptz
              )
              RETURNING id, blind_test_enabled, name, code, status, created_at, expires_at, version
            ), created_membership AS (
              INSERT INTO memberships (
                lobby_id, participant_id, display_name, is_creator, joined_at
              )
              SELECT id, $4, $5, true, $3::timestamptz FROM created_lobby
              RETURNING lobby_id, display_name, is_creator, joined_at
            )
            SELECT
              lobby.id,
              lobby.blind_test_enabled,
              lobby.name,
              lobby.code,
              lobby.status,
              lobby.created_at,
              lobby.expires_at,
              membership.display_name,
              membership.is_creator,
              membership.joined_at,
              1::integer AS member_count,
              lobby.version
            FROM created_lobby lobby
            JOIN created_membership membership ON membership.lobby_id = lobby.id
          `,
          [
            input.name,
            this.generateCode(),
            now,
            input.participantId,
            input.displayName,
            this.ttlHours,
          ],
        );

        return serializeLobby(requireRow(result.rows[0]));
      } catch (error) {
        if (isLobbyCodeCollision(error)) {
          continue;
        }

        throw error;
      }
    }

    throw new Error("Could not allocate a unique lobby code");
  }

  async join(input: JoinLobbyInput): Promise<LobbyResponse> {
    const now = this.clock();
    const result = await this.options.database.query<LobbyRow>(
      `
        WITH target AS (
          UPDATE lobbies
          SET last_activity_at = $4::timestamptz
          WHERE code = $1
            AND status = 'open'
            AND expires_at > $4::timestamptz
          RETURNING id, blind_test_enabled, name, code, status, created_at, expires_at, version
        ), existing_membership AS (
          SELECT 1
          FROM memberships membership
          JOIN target ON target.id = membership.lobby_id
          WHERE membership.participant_id = $2
            AND membership.left_at IS NULL
        ), joined_membership AS (
          INSERT INTO memberships (
            lobby_id, participant_id, display_name, is_creator, joined_at, left_at
          )
          SELECT id, $2, $3, false, $4::timestamptz, NULL FROM target
          ON CONFLICT (lobby_id, participant_id) DO UPDATE
          SET display_name = EXCLUDED.display_name, left_at = NULL
          RETURNING lobby_id, display_name, is_creator, joined_at
        )
        SELECT
          lobby.id,
          lobby.blind_test_enabled,
          lobby.name,
          lobby.code,
          lobby.status,
          lobby.created_at,
          lobby.expires_at,
          membership.display_name,
          membership.is_creator,
          membership.joined_at,
          lobby.version,
          (
            SELECT count(*)::integer +
              CASE WHEN EXISTS (SELECT 1 FROM existing_membership) THEN 0 ELSE 1 END
            FROM memberships members
            WHERE members.lobby_id = lobby.id AND members.left_at IS NULL
          ) AS member_count
        FROM target lobby
        JOIN joined_membership membership ON membership.lobby_id = lobby.id
      `,
      [input.code, input.participantId, input.displayName, now],
    );

    if (!result.rows[0]) {
      throw new LobbyUnavailableError("Lobby cannot be joined");
    }

    return serializeLobby(result.rows[0]);
  }

  async get(lobbyId: string, participantId: string): Promise<LobbyResponse> {
    const result = await this.options.database.query<LobbyRow>(
      `
        SELECT
          lobby.id,
          lobby.blind_test_enabled,
          lobby.name,
          lobby.code,
          lobby.status,
          lobby.created_at,
          lobby.expires_at,
          membership.display_name,
          membership.is_creator,
          membership.joined_at,
          lobby.version,
          (
            SELECT count(*)::integer
            FROM memberships members
            WHERE members.lobby_id = lobby.id AND members.left_at IS NULL
          ) AS member_count
        FROM lobbies lobby
        JOIN memberships membership
          ON membership.lobby_id = lobby.id
          AND membership.participant_id = $2
          AND membership.left_at IS NULL
        WHERE lobby.id = $1
          AND lobby.status = 'open'
          AND lobby.expires_at > $3
      `,
      [lobbyId, participantId, this.clock()],
    );

    if (!result.rows[0]) {
      throw new LobbyUnavailableError(
        "Lobby is not available to this participant",
      );
    }

    return serializeLobby(result.rows[0]);
  }

  async updateSettings(
    lobbyId: string,
    participantId: string,
    input: UpdateLobbySettingsRequest,
  ): Promise<LobbySettingsUpdateResult> {
    const now = this.clock();
    const result = await this.options.database.query<LobbyRow>(
      `
        UPDATE lobbies lobby
        SET blind_test_enabled = $3,
            version = version + 1,
            last_activity_at = $4
        FROM memberships membership
        WHERE lobby.id = $1
          AND lobby.status = 'open'
          AND lobby.expires_at > $4
          AND lobby.blind_test_enabled IS DISTINCT FROM $3
          AND membership.lobby_id = lobby.id
          AND membership.participant_id = $2
          AND membership.left_at IS NULL
          AND membership.is_creator = true
        RETURNING
          lobby.id,
          lobby.blind_test_enabled,
          lobby.name,
          lobby.code,
          lobby.status,
          lobby.created_at,
          lobby.expires_at,
          membership.display_name,
          membership.is_creator,
          membership.joined_at,
          lobby.version,
          (
            SELECT count(*)::integer
            FROM memberships members
            WHERE members.lobby_id = lobby.id AND members.left_at IS NULL
          ) AS member_count
      `,
      [lobbyId, participantId, input.blindTestEnabled, now],
    );

    if (result.rows[0]) {
      return { changed: true, lobby: serializeLobby(result.rows[0]) };
    }

    const current = await this.get(lobbyId, participantId);

    if (!current.membership.isCreator) {
      throw new LobbySettingsCreatorRequiredError(
        "Only the lobby creator can update its settings",
      );
    }

    return { changed: false, lobby: current };
  }
}

const lobbyCodeAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateLobbyCode(): string {
  return Array.from(
    { length: 6 },
    () => lobbyCodeAlphabet[randomInt(lobbyCodeAlphabet.length)],
  ).join("");
}

function requireRow(row: LobbyRow | undefined): LobbyRow {
  if (!row) {
    throw new Error("Lobby mutation returned no row");
  }

  return row;
}

function serializeLobby(row: LobbyRow): LobbyResponse {
  return LobbyResponseSchema.parse({
    code: row.code,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    id: row.id,
    invitePath: `/join/${row.code}`,
    memberCount: Number(row.member_count),
    membership: {
      displayName: row.display_name,
      isCreator: row.is_creator,
      joinedAt: row.joined_at.toISOString(),
    },
    name: row.name,
    settings: { blindTestEnabled: row.blind_test_enabled },
    status: row.status,
    version: Number(row.version),
  });
}

function isLobbyCodeCollision(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505" &&
    "constraint" in error &&
    error.constraint === "lobbies_code_key"
  );
}
