import { describe, expect, it } from "vitest";

import {
  CatalogSearchQuerySchema,
  CatalogSearchResponseSchema,
  CreateLobbyRequestSchema,
  JoinLobbyRequestSchema,
  LobbyResponseSchema,
  ClaimPlayerRequestSchema,
  PlaybackReportRequestSchema,
  PlayerSnapshotSchema,
  ProviderConnectionsResponseSchema,
  PublicProviderConnectionSchema,
  AddQueueItemRequestSchema,
  QueueSnapshotSchema,
  ReorderQueueRequestSchema,
} from "./index.js";

describe("catalog search contracts", () => {
  it("trims queries and bounds input, quota and cursor sizes", () => {
    expect(CatalogSearchQuerySchema.parse({ q: "  midnight  " })).toEqual({
      limit: 10,
      q: "midnight",
    });
    expect(
      CatalogSearchQuerySchema.safeParse({ limit: 21, q: "midnight" }).success,
    ).toBe(false);
    expect(CatalogSearchQuerySchema.safeParse({ q: "x" }).success).toBe(false);
    expect(
      CatalogSearchQuerySchema.safeParse({ cursor: "x".repeat(201), q: "ok" })
        .success,
    ).toBe(false);
  });

  it("strips credential-shaped fields from results and issues", () => {
    const serialized = CatalogSearchResponseSchema.parse({
      accessToken: "top-level-secret",
      cursors: [],
      issues: [],
      results: [
        {
          album: "Neon Rooms",
          artists: ["The Determinists"],
          durationMs: 180_000,
          explicit: false,
          id: "result-1",
          imageUrl: null,
          isrc: "FAKE00000001",
          refreshToken: "result-secret",
          title: "Midnight Relay",
          variants: [
            {
              accessToken: "variant-secret",
              connectionId: "fake:lobby",
              playbackAvailability: "playable",
              provider: "fake",
              providerTrackId: "fake:track",
            },
          ],
        },
      ],
    });

    expect(JSON.stringify(serialized)).not.toMatch(
      /top-level-secret|result-secret|variant-secret|accessToken|refreshToken/,
    );
  });
});

describe("lobby contracts", () => {
  it("normalizes bounded creation and join input", () => {
    expect(
      CreateLobbyRequestSchema.parse({
        displayName: "  Camille  ",
        name: "  Anniversaire  ",
      }),
    ).toEqual({ displayName: "Camille", name: "Anniversaire" });
    expect(
      JoinLobbyRequestSchema.parse({ code: " ab2c3d ", displayName: " Noor " }),
    ).toEqual({ code: "AB2C3D", displayName: "Noor" });
  });

  it.each(["O23456", "I23456", "L23456", "A12345", "A2345", "A234567"])(
    "rejects the ambiguous or invalid code %s",
    (code) => {
      expect(
        JoinLobbyRequestSchema.safeParse({ code, displayName: "Noor" }).success,
      ).toBe(false);
    },
  );

  it("accepts a public lobby without internal identity fields", () => {
    expect(
      LobbyResponseSchema.parse({
        code: "AB2C3D",
        createdAt: "2026-08-08T12:00:00.000Z",
        expiresAt: "2026-08-09T12:00:00.000Z",
        id: "019c28ce-66d7-4733-a38c-f7aefb572429",
        invitePath: "/join/AB2C3D",
        memberCount: 1,
        membership: {
          displayName: "Camille",
          isCreator: true,
          joinedAt: "2026-08-08T12:00:00.000Z",
        },
        name: "Anniversaire",
        participantId: "must-not-leak",
        status: "open",
      }),
    ).not.toHaveProperty("participantId");
  });
});

describe("queue contracts", () => {
  const track = {
    album: "Neon Rooms",
    artists: ["The Determinists"],
    durationMs: 180_000,
    explicit: false,
    id: "logical-track",
    imageUrl: null,
    isrc: "FAKE00000001",
    title: "Midnight Relay",
    variants: [
      {
        connectionId: "fake:lobby",
        playbackAvailability: "playable" as const,
        provider: "fake",
        providerTrackId: "fake:track",
      },
    ],
  };

  it("bounds queue mutations and rejects duplicate reorder identifiers", () => {
    expect(
      AddQueueItemRequestSchema.safeParse({
        commandId: "019c28ce-66d7-4733-a38c-f7aefb572429",
        track,
      }).success,
    ).toBe(true);
    expect(
      ReorderQueueRequestSchema.safeParse({
        commandId: "019c28ce-66d7-4733-a38c-f7aefb572429",
        expectedVersion: 2,
        itemIds: [
          "019c28cf-66d7-4733-a38c-f7aefb572429",
          "019c28cf-66d7-4733-a38c-f7aefb572429",
        ],
      }).success,
    ).toBe(false);
  });

  it("strips secrets from queue snapshots at every nested level", () => {
    const snapshot = QueueSnapshotSchema.parse({
      accessToken: "top-secret",
      generatedAt: "2026-08-08T12:00:00.000Z",
      items: [
        {
          addedAt: "2026-08-08T12:00:00.000Z",
          addedByDisplayName: "Camille",
          id: "019c28cf-66d7-4733-a38c-f7aefb572429",
          track: {
            ...track,
            refreshToken: "track-secret",
            variants: [
              {
                ...track.variants[0],
                accessToken: "variant-secret",
              },
            ],
          },
        },
      ],
      lobbyId: "019c28ce-66d7-4733-a38c-f7aefb572429",
      version: 1,
    });

    expect(JSON.stringify(snapshot)).not.toMatch(
      /top-secret|track-secret|variant-secret|accessToken|refreshToken/,
    );
  });
});

describe("player contracts", () => {
  it("requires opaque browser identity and a positive lease generation", () => {
    expect(
      ClaimPlayerRequestSchema.safeParse({
        commandId: "019c28ce-66d7-4733-a38c-f7aefb572429",
        deviceId: "not-a-device-id",
      }).success,
    ).toBe(false);
    expect(
      PlaybackReportRequestSchema.safeParse({
        commandId: "019c28ce-66d7-4733-a38c-f7aefb572429",
        deviceId: "019c28cf-66d7-4733-a38c-f7aefb572429",
        generation: 0,
        outcome: "ended",
      }).success,
    ).toBe(false);
  });

  it("strips device and credential fields from playback snapshots", () => {
    const snapshot = PlayerSnapshotSchema.parse({
      accessToken: "top-secret",
      currentItem: null,
      deviceId: "private-device",
      lastTransition: null,
      lease: {
        deviceId: "private-device",
        expiresAt: null,
        generation: null,
        heldByCurrentDevice: false,
        holderDisplayName: null,
        refreshToken: "nested-secret",
        status: "available",
      },
      lobbyId: "019c28ce-66d7-4733-a38c-f7aefb572429",
      positionMs: 0,
      state: "idle",
      version: 0,
    });

    expect(JSON.stringify(snapshot)).not.toMatch(
      /deviceId|accessToken|refreshToken|private-device|secret/,
    );
  });
});

describe("public provider connection contract", () => {
  it("structurally strips every credential field", () => {
    const serialized = PublicProviderConnectionSchema.parse({
      accessToken: "access-secret",
      capabilities: ["catalog_search", "web_playback"],
      consentedForLobby: true,
      encryptedCredentials: {
        authTag: "tag-secret",
        ciphertext: "ciphertext-secret",
        iv: "iv-secret",
        keyVersion: 1,
      },
      id: "019c28ce-66d7-7733-a38c-f7aefb572429",
      ownerParticipantId: "019c28cf-4167-764d-88c1-aefbedb2420d",
      provider: "spotify",
      refreshToken: "refresh-secret",
      revokedAt: null,
    });

    expect(serialized).toEqual({
      capabilities: ["catalog_search", "web_playback"],
      consentedForLobby: true,
      id: "019c28ce-66d7-7733-a38c-f7aefb572429",
      ownerParticipantId: "019c28cf-4167-764d-88c1-aefbedb2420d",
      provider: "spotify",
      revokedAt: null,
    });
    expect(JSON.stringify(serialized)).not.toMatch(
      /access-secret|refresh-secret|ciphertext-secret|tag-secret|iv-secret/,
    );
  });

  it("publishes fake limits without accepting credential fields", () => {
    const serialized = ProviderConnectionsResponseSchema.parse({
      connections: [
        {
          accessToken: "must-not-leak",
          capabilities: ["catalog_search", "web_playback"],
          credentialStatus: "active",
          displayName: "Mode démo",
          id: "fake:lobby-id",
          isSimulation: true,
          limitations: ["Catalogue simulé."],
          provider: "fake",
          refreshToken: "must-not-leak-either",
        },
      ],
    });

    expect(serialized.connections[0]).not.toHaveProperty("accessToken");
    expect(serialized.connections[0]).not.toHaveProperty("refreshToken");
    expect(JSON.stringify(serialized)).not.toContain("must-not-leak");
  });
});
