import { Writable } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp, type DatabaseClient } from "./app.js";
import type { GuestIdentityManager } from "./identity/guest-identity.js";
import { LobbyUnavailableError } from "./lobby/lobby-service.js";
import { QueueConflictError } from "./queue/queue-service.js";

const openApps: Array<ReturnType<typeof buildApp>> = [];
const silentLogger = new Writable({
  write(_chunk, _encoding, callback) {
    callback();
  },
});

afterEach(async () => {
  await Promise.all(openApps.splice(0).map(async (app) => app.close()));
});

function createDatabase(
  query = vi.fn().mockResolvedValue({ rows: [{ ok: 1 }] }),
) {
  return {
    end: vi.fn().mockResolvedValue(undefined),
    query,
  } satisfies DatabaseClient;
}

function createGuestIdentity(
  resolve = vi.fn().mockResolvedValue({
    created: true,
    expiresAt: new Date("2026-08-09T12:00:00.000Z"),
    participantId: "019c28ce-66d7-7733-a38c-f7aefb572429",
    setCookie:
      "easyplaylist_guest=signed-value; Path=/; HttpOnly; SameSite=Lax",
  }),
) {
  return { resolve } as unknown as GuestIdentityManager;
}

const publicLobby = {
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
  status: "open" as const,
};

function createLobbyService() {
  return {
    create: vi.fn().mockResolvedValue(publicLobby),
    get: vi.fn().mockResolvedValue(publicLobby),
    join: vi.fn().mockResolvedValue(publicLobby),
  };
}

function createProviderCatalog() {
  return {
    listForLobby: vi.fn().mockResolvedValue([
      {
        capabilities: ["catalog_search", "web_playback"],
        credentialStatus: "active",
        displayName: "Mode démo",
        id: "fake:lobby-id",
        isSimulation: true,
        limitations: ["Catalogue simulé."],
        provider: "fake",
      },
    ]),
    searchForLobby: vi.fn().mockResolvedValue({
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
          title: "Midnight Relay",
          variants: [
            {
              connectionId: "fake:lobby-id",
              playbackAvailability: "playable",
              provider: "fake",
              providerTrackId: "fake:track-1",
            },
          ],
        },
      ],
    }),
  };
}

const queueTrack = {
  album: "Neon Rooms",
  artists: ["The Determinists"],
  durationMs: 180_000,
  explicit: false,
  id: "result-1",
  imageUrl: null,
  isrc: "FAKE00000001",
  title: "Midnight Relay",
  variants: [
    {
      connectionId: "fake:lobby-id",
      playbackAvailability: "playable" as const,
      provider: "fake",
      providerTrackId: "fake:track-1",
    },
  ],
};

const queueSnapshot = {
  generatedAt: "2026-08-08T12:00:00.000Z",
  items: [
    {
      addedAt: "2026-08-08T12:00:00.000Z",
      addedByDisplayName: "Camille",
      id: "019c28d1-0000-4000-8000-000000000001",
      track: queueTrack,
    },
  ],
  lobbyId: publicLobby.id,
  version: 1,
};

function createQueueService() {
  return {
    add: vi
      .fn()
      .mockResolvedValue({ replayed: false, snapshot: queueSnapshot }),
    getSnapshot: vi.fn().mockResolvedValue(queueSnapshot),
    remove: vi
      .fn()
      .mockResolvedValue({ replayed: false, snapshot: queueSnapshot }),
    reorder: vi
      .fn()
      .mockResolvedValue({ replayed: false, snapshot: queueSnapshot }),
  };
}

describe("health routes", () => {
  it("returns a liveness response without querying PostgreSQL", async () => {
    const database = createDatabase();
    const app = buildApp({
      database,
      guestIdentity: createGuestIdentity(),
      lobbyService: createLobbyService(),
      loggerStream: silentLogger,
      providerCatalog: createProviderCatalog(),
    });
    openApps.push(app);

    const response = await app.inject({ method: "GET", url: "/health/live" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ service: "api", status: "ok" });
    expect(database.query).not.toHaveBeenCalled();
  });

  it("reports PostgreSQL failures through readiness", async () => {
    const database = createDatabase(
      vi.fn().mockRejectedValue(new Error("offline")),
    );
    const app = buildApp({
      database,
      guestIdentity: createGuestIdentity(),
      lobbyService: createLobbyService(),
      loggerStream: silentLogger,
      providerCatalog: createProviderCatalog(),
    });
    openApps.push(app);

    const response = await app.inject({ method: "GET", url: "/health/ready" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      checks: { database: "down" },
      service: "api",
      status: "unavailable",
    });
  });
});

describe("safe request logging", () => {
  it("includes a request id and redacts credentials", async () => {
    let logs = "";
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        logs += chunk.toString();
        callback();
      },
    });
    const app = buildApp({
      database: createDatabase(),
      guestIdentity: createGuestIdentity(),
      lobbyService: createLobbyService(),
      loggerStream: stream,
      providerCatalog: createProviderCatalog(),
    });
    openApps.push(app);

    app.log.info(
      {
        accessToken: "access-secret",
        authorization: "Bearer log-probe",
        cookie: "guest=cookie-secret",
        credentials: { ciphertext: "ciphertext-secret" },
        encryptedCredentials: "envelope-secret",
        refreshToken: "refresh-secret",
        secret: "provider-secret",
        token: "generic-secret",
      },
      "redaction probe",
    );
    await app.inject({ method: "GET", url: "/health/live" });

    expect(logs).toContain('"requestId":');
    expect(logs).toContain('"authorization":"[Redacted]"');
    expect(logs).not.toMatch(
      /access-secret|authorization-secret|cookie-secret|ciphertext-secret|envelope-secret|provider-secret|refresh-secret|generic-secret/,
    );
  });
});

describe("guest identity route", () => {
  it("returns only the public identity and a hardened cookie", async () => {
    const guestIdentity = createGuestIdentity();
    const app = buildApp({
      database: createDatabase(),
      guestIdentity,
      lobbyService: createLobbyService(),
      loggerStream: silentLogger,
      providerCatalog: createProviderCatalog(),
    });
    openApps.push(app);

    const response = await app.inject({
      headers: { cookie: "easyplaylist_guest=existing-signed-value" },
      method: "POST",
      url: "/identity/guest",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      expiresAt: "2026-08-09T12:00:00.000Z",
      isNew: true,
      participantId: "019c28ce-66d7-7733-a38c-f7aefb572429",
    });
    expect(response.headers["set-cookie"]).toContain("HttpOnly");
    expect(guestIdentity.resolve).toHaveBeenCalledWith(
      "easyplaylist_guest=existing-signed-value",
    );
  });

  it("returns a bounded error when persistence fails", async () => {
    const guestIdentity = createGuestIdentity(
      vi.fn().mockRejectedValue(new Error("database detail")),
    );
    const app = buildApp({
      database: createDatabase(),
      guestIdentity,
      lobbyService: createLobbyService(),
      loggerStream: silentLogger,
      providerCatalog: createProviderCatalog(),
    });
    openApps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/identity/guest",
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      code: "IDENTITY_UNAVAILABLE",
      message: "Guest identity is temporarily unavailable",
    });
    expect(response.body).not.toContain("database detail");
  });
});

describe("lobby routes", () => {
  it("creates a lobby for the resolved guest and returns a creator membership", async () => {
    const lobbyService = createLobbyService();
    const app = buildApp({
      database: createDatabase(),
      guestIdentity: createGuestIdentity(),
      lobbyService,
      loggerStream: silentLogger,
      providerCatalog: createProviderCatalog(),
    });
    openApps.push(app);

    const response = await app.inject({
      method: "POST",
      payload: { displayName: " Camille ", name: " Anniversaire " },
      url: "/lobbies",
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(publicLobby);
    expect(lobbyService.create).toHaveBeenCalledWith({
      displayName: "Camille",
      name: "Anniversaire",
      participantId: "019c28ce-66d7-7733-a38c-f7aefb572429",
    });
  });

  it("normalizes a join code and keeps unavailable lobbies indistinguishable", async () => {
    const lobbyService = createLobbyService();
    lobbyService.join.mockRejectedValue(
      new LobbyUnavailableError("expired detail"),
    );
    const app = buildApp({
      database: createDatabase(),
      guestIdentity: createGuestIdentity(),
      lobbyService,
      loggerStream: silentLogger,
      providerCatalog: createProviderCatalog(),
    });
    openApps.push(app);

    const response = await app.inject({
      method: "POST",
      payload: { code: " ab2c3d ", displayName: " Noor " },
      url: "/lobbies/join",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      code: "LOBBY_UNAVAILABLE",
      message: "This lobby cannot be joined",
    });
    expect(response.body).not.toContain("expired detail");
    expect(lobbyService.join).toHaveBeenCalledWith({
      code: "AB2C3D",
      displayName: "Noor",
      participantId: "019c28ce-66d7-7733-a38c-f7aefb572429",
    });
  });

  it("rejects malformed lobby input before resolving an identity", async () => {
    const guestIdentity = createGuestIdentity();
    const app = buildApp({
      database: createDatabase(),
      guestIdentity,
      lobbyService: createLobbyService(),
      loggerStream: silentLogger,
      providerCatalog: createProviderCatalog(),
    });
    openApps.push(app);

    const response = await app.inject({
      method: "POST",
      payload: { code: "O0I1L", displayName: "" },
      url: "/lobbies/join",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      code: "INVALID_REQUEST",
      message: "The request contains invalid fields",
    });
    expect(guestIdentity.resolve).not.toHaveBeenCalled();
  });
});

describe("provider catalog route", () => {
  it("lists only public fake capabilities for a lobby member", async () => {
    const lobbyService = createLobbyService();
    const providerCatalog = createProviderCatalog();
    const app = buildApp({
      database: createDatabase(),
      guestIdentity: createGuestIdentity(),
      lobbyService,
      loggerStream: silentLogger,
      providerCatalog,
    });
    openApps.push(app);

    const response = await app.inject({
      method: "GET",
      url: `/lobbies/${publicLobby.id}/providers`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      connections: [
        {
          capabilities: ["catalog_search", "web_playback"],
          credentialStatus: "active",
          displayName: "Mode démo",
          id: "fake:lobby-id",
          isSimulation: true,
          limitations: ["Catalogue simulé."],
          provider: "fake",
        },
      ],
    });
    expect(lobbyService.get).toHaveBeenCalledWith(
      publicLobby.id,
      "019c28ce-66d7-7733-a38c-f7aefb572429",
    );
    expect(providerCatalog.listForLobby).toHaveBeenCalledWith(publicLobby.id);
    expect(response.body).not.toMatch(
      /accessToken|refreshToken|encryptedCredentials|ownerParticipantId|ciphertext|authTag/,
    );
  });

  it("does not reveal providers outside the resolved membership", async () => {
    const lobbyService = createLobbyService();
    lobbyService.get.mockRejectedValue(
      new LobbyUnavailableError("cross-lobby detail"),
    );
    const providerCatalog = createProviderCatalog();
    const app = buildApp({
      database: createDatabase(),
      guestIdentity: createGuestIdentity(),
      lobbyService,
      loggerStream: silentLogger,
      providerCatalog,
    });
    openApps.push(app);

    const response = await app.inject({
      method: "GET",
      url: `/lobbies/${publicLobby.id}/providers`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      code: "LOBBY_NOT_FOUND",
      message: "This lobby is not available",
    });
    expect(response.body).not.toContain("cross-lobby detail");
    expect(providerCatalog.listForLobby).not.toHaveBeenCalled();
  });
});

describe("catalog search route", () => {
  it("validates membership and returns bounded normalized results", async () => {
    const lobbyService = createLobbyService();
    const providerCatalog = createProviderCatalog();
    const app = buildApp({
      database: createDatabase(),
      guestIdentity: createGuestIdentity(),
      lobbyService,
      loggerStream: silentLogger,
      providerCatalog,
    });
    openApps.push(app);

    const response = await app.inject({
      method: "GET",
      url: `/lobbies/${publicLobby.id}/search?q=%20midnight%20&limit=5`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      issues: [],
      results: [
        {
          title: "Midnight Relay",
          variants: [
            {
              connectionId: "fake:lobby-id",
              playbackAvailability: "playable",
              provider: "fake",
            },
          ],
        },
      ],
    });
    expect(lobbyService.get).toHaveBeenCalledWith(
      publicLobby.id,
      "019c28ce-66d7-7733-a38c-f7aefb572429",
    );
    expect(providerCatalog.searchForLobby).toHaveBeenCalledWith(
      publicLobby.id,
      { limit: 5, q: "midnight" },
    );
    expect(response.body).not.toMatch(
      /accessToken|refreshToken|encryptedCredentials|ciphertext|authTag/,
    );
  });

  it("rejects unbounded input before resolving identity", async () => {
    const guestIdentity = createGuestIdentity();
    const providerCatalog = createProviderCatalog();
    const app = buildApp({
      database: createDatabase(),
      guestIdentity,
      lobbyService: createLobbyService(),
      loggerStream: silentLogger,
      providerCatalog,
    });
    openApps.push(app);

    const response = await app.inject({
      method: "GET",
      url: `/lobbies/${publicLobby.id}/search?q=x&limit=21`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      code: "INVALID_REQUEST",
      message: "The request contains invalid fields",
    });
    expect(guestIdentity.resolve).not.toHaveBeenCalled();
    expect(providerCatalog.searchForLobby).not.toHaveBeenCalled();
  });

  it("does not search outside the resolved membership", async () => {
    const lobbyService = createLobbyService();
    lobbyService.get.mockRejectedValue(
      new LobbyUnavailableError("cross-lobby search detail"),
    );
    const providerCatalog = createProviderCatalog();
    const app = buildApp({
      database: createDatabase(),
      guestIdentity: createGuestIdentity(),
      lobbyService,
      loggerStream: silentLogger,
      providerCatalog,
    });
    openApps.push(app);

    const response = await app.inject({
      method: "GET",
      url: `/lobbies/${publicLobby.id}/search?q=midnight`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      code: "LOBBY_NOT_FOUND",
      message: "This lobby is not available",
    });
    expect(response.body).not.toContain("cross-lobby search detail");
    expect(providerCatalog.searchForLobby).not.toHaveBeenCalled();
  });
});

describe("queue routes", () => {
  it("validates and authorizes a bounded idempotent addition", async () => {
    const queueService = createQueueService();
    const app = buildApp({
      database: createDatabase(),
      guestIdentity: createGuestIdentity(),
      lobbyService: createLobbyService(),
      loggerStream: silentLogger,
      providerCatalog: createProviderCatalog(),
      queueService,
    });
    openApps.push(app);

    const response = await app.inject({
      method: "POST",
      payload: {
        commandId: "019c28d1-0000-4000-8000-000000000002",
        track: queueTrack,
      },
      url: `/lobbies/${publicLobby.id}/queue/items`,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      replayed: false,
      snapshot: queueSnapshot,
    });
    expect(queueService.add).toHaveBeenCalledWith(
      publicLobby.id,
      "019c28ce-66d7-7733-a38c-f7aefb572429",
      {
        commandId: "019c28d1-0000-4000-8000-000000000002",
        track: queueTrack,
      },
    );
  });

  it("rejects malformed commands before resolving the guest identity", async () => {
    const guestIdentity = createGuestIdentity();
    const queueService = createQueueService();
    const app = buildApp({
      database: createDatabase(),
      guestIdentity,
      lobbyService: createLobbyService(),
      loggerStream: silentLogger,
      providerCatalog: createProviderCatalog(),
      queueService,
    });
    openApps.push(app);

    const response = await app.inject({
      method: "POST",
      payload: { commandId: "not-a-uuid", track: queueTrack },
      url: `/lobbies/${publicLobby.id}/queue/items`,
    });

    expect(response.statusCode).toBe(400);
    expect(guestIdentity.resolve).not.toHaveBeenCalled();
    expect(queueService.add).not.toHaveBeenCalled();
  });

  it("returns the authoritative snapshot with an observable version conflict", async () => {
    const queueService = createQueueService();
    queueService.reorder.mockRejectedValue(
      new QueueConflictError(
        "QUEUE_VERSION_CONFLICT",
        "internal detail",
        queueSnapshot,
      ),
    );
    const app = buildApp({
      database: createDatabase(),
      guestIdentity: createGuestIdentity(),
      lobbyService: createLobbyService(),
      loggerStream: silentLogger,
      providerCatalog: createProviderCatalog(),
      queueService,
    });
    openApps.push(app);

    const response = await app.inject({
      method: "PUT",
      payload: {
        commandId: "019c28d1-0000-4000-8000-000000000003",
        expectedVersion: 0,
        itemIds: [queueSnapshot.items[0]!.id],
      },
      url: `/lobbies/${publicLobby.id}/queue/order`,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      code: "QUEUE_VERSION_CONFLICT",
      message: "The queue changed before this command",
      snapshot: queueSnapshot,
    });
    expect(response.body).not.toContain("internal detail");
  });
});
