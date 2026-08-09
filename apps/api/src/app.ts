import {
  ApiErrorResponseSchema,
  CatalogSearchQuerySchema,
  CatalogSearchResponseSchema,
  CreateLobbyRequestSchema,
  GuestIdentityResponseSchema,
  JoinLobbyRequestSchema,
  LivenessResponseSchema,
  CloseLobbyResponseSchema,
  LobbyIdParameterSchema,
  LobbyRealtimeEventSchema,
  LobbyResponseSchema,
  PlaybackCommandParameterSchema,
  PlaybackControlRequestSchema,
  PlaybackRealtimeEventSchema,
  PlaybackReportRequestSchema,
  PlayerErrorResponseSchema,
  PlayerHeartbeatRequestSchema,
  PlayerMutationResponseSchema,
  PlayerSnapshotQuerySchema,
  PlayerSnapshotSchema,
  ClaimPlayerRequestSchema,
  ProviderConnectionsResponseSchema,
  QueueErrorResponseSchema,
  QueueItemParameterSchema,
  QueueMutationResponseSchema,
  QueueRealtimeEventSchema,
  QueueSnapshotSchema,
  ReadinessResponseSchema,
  AddQueueItemRequestSchema,
  RemoveQueueItemRequestSchema,
  ReorderQueueRequestSchema,
  UpdateLobbySettingsRequestSchema,
} from "@easyplaylist/contracts";
import Fastify, { LogController } from "fastify";
import { Server as SocketServer } from "socket.io";

import type { GuestIdentityManager } from "./identity/guest-identity.js";
import {
  LobbyCreatorRequiredError,
  LobbyLifecycleUnavailableError,
  type LobbyLifecycleService,
} from "./lobby/lobby-lifecycle-service.js";
import {
  LobbySettingsCreatorRequiredError,
  LobbyUnavailableError,
  type LobbyService,
} from "./lobby/lobby-service.js";
import type { ProviderCatalog } from "./provider/provider-catalog.js";
import {
  PlayerAccessError,
  PlayerConflictError,
  type PlaybackService,
} from "./playback/playback-service.js";
import {
  QueueAccessError,
  QueueConflictError,
  type QueueService,
} from "./queue/queue-service.js";

export interface DatabaseClient {
  end(): Promise<void>;
  query(query: string): Promise<unknown>;
}

interface BuildAppOptions {
  database: DatabaseClient;
  guestIdentity: GuestIdentityManager;
  lobbyLifecycleService?: Pick<LobbyLifecycleService, "close">;
  lobbyService: Pick<
    LobbyService,
    "create" | "get" | "join" | "updateSettings"
  >;
  loggerStream?: LoggerStreamDestination;
  providerCatalog: Pick<ProviderCatalog, "listForLobby" | "searchForLobby"> &
    Partial<Pick<ProviderCatalog, "purgeLobby">>;
  playbackService?: Pick<
    PlaybackService,
    "claim" | "control" | "getSnapshot" | "heartbeat" | "report"
  >;
  queueService?: Pick<
    QueueService,
    "add" | "getSnapshot" | "remove" | "reorder"
  >;
}

interface LoggerStreamDestination {
  write(message: string): void;
}

const sensitiveLogPaths = [
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers.set-cookie",
  "authorization",
  "cookie",
  "token",
  "accessToken",
  "refreshToken",
  "secret",
  "credentials",
  "encryptedCredentials",
  "ciphertext",
  "authTag",
  "*.token",
  "*.accessToken",
  "*.refreshToken",
  "*.secret",
  "*.credentials",
  "*.encryptedCredentials",
  "*.ciphertext",
  "*.authTag",
];

export function buildApp({
  database,
  guestIdentity,
  lobbyLifecycleService: providedLobbyLifecycleService,
  lobbyService,
  loggerStream,
  providerCatalog,
  playbackService: providedPlaybackService,
  queueService: providedQueueService,
}: BuildAppOptions) {
  const app = Fastify({
    logger: {
      redact: sensitiveLogPaths,
      stream: loggerStream,
    },
    logController: new LogController({
      requestIdLogLabel: "requestId",
    }),
  });
  const queueService = providedQueueService ?? unavailableQueueService;
  const playbackService = providedPlaybackService ?? unavailablePlaybackService;
  const lobbyLifecycleService =
    providedLobbyLifecycleService ?? unavailableLobbyLifecycleService;
  const realtime = new SocketServer(app.server, {
    path: "/socket.io",
    serveClient: false,
  });

  realtime.on("connection", (socket) => {
    socket.on(
      "queue:join",
      async (payload: unknown, acknowledge?: (result: unknown) => void) => {
        const parsed = LobbyIdParameterSchema.safeParse(
          typeof payload === "object" && payload !== null
            ? { id: Reflect.get(payload, "lobbyId") }
            : payload,
        );

        if (!parsed.success) {
          acknowledge?.({ code: "INVALID_REQUEST", ok: false });
          return;
        }

        try {
          const identity = await guestIdentity.resolve(
            socket.handshake.headers.cookie,
          );
          const snapshot = await queueService.getSnapshot(
            parsed.data.id,
            identity.participantId,
          );
          await socket.join(queueRoom(parsed.data.id));
          socket.emit(
            "queue:event",
            QueueRealtimeEventSchema.parse({
              snapshot,
              type: "queue.snapshot",
            }),
          );
          acknowledge?.({ ok: true, version: snapshot.version });
        } catch {
          acknowledge?.({ code: "LOBBY_NOT_FOUND", ok: false });
          socket.disconnect(true);
        }
      },
    );

    socket.on(
      "playback:join",
      async (payload: unknown, acknowledge?: (result: unknown) => void) => {
        const parsedLobby = LobbyIdParameterSchema.safeParse(
          typeof payload === "object" && payload !== null
            ? { id: Reflect.get(payload, "lobbyId") }
            : payload,
        );
        const parsedDevice = PlayerSnapshotQuerySchema.safeParse(payload);

        if (!parsedLobby.success || !parsedDevice.success) {
          acknowledge?.({ code: "INVALID_REQUEST", ok: false });
          return;
        }

        try {
          const identity = await guestIdentity.resolve(
            socket.handshake.headers.cookie,
          );
          const snapshot = await playbackService.getSnapshot(
            parsedLobby.data.id,
            identity.participantId,
            parsedDevice.data.deviceId,
          );
          await socket.join(queueRoom(parsedLobby.data.id));
          acknowledge?.({ ok: true, version: snapshot.version });
        } catch {
          acknowledge?.({ code: "LOBBY_NOT_FOUND", ok: false });
        }
      },
    );
  });

  app.get("/health/live", async () =>
    LivenessResponseSchema.parse({
      service: "api",
      status: "ok",
    }),
  );

  app.get("/health/ready", async (_request, reply) => {
    try {
      await database.query("SELECT 1");

      return ReadinessResponseSchema.parse({
        checks: { database: "up" },
        service: "api",
        status: "ready",
      });
    } catch {
      app.log.warn("PostgreSQL readiness check failed");

      return reply.code(503).send(
        ReadinessResponseSchema.parse({
          checks: { database: "down" },
          service: "api",
          status: "unavailable",
        }),
      );
    }
  });

  app.post("/identity/guest", async (request, reply) => {
    try {
      const identity = await guestIdentity.resolve(request.headers.cookie);

      if (identity.setCookie) {
        reply.header("set-cookie", identity.setCookie);
      }

      return GuestIdentityResponseSchema.parse({
        expiresAt: identity.expiresAt.toISOString(),
        isNew: identity.created,
        participantId: identity.participantId,
      });
    } catch {
      app.log.warn("Guest identity persistence failed");

      return reply.code(503).send(
        ApiErrorResponseSchema.parse({
          code: "IDENTITY_UNAVAILABLE",
          message: "Guest identity is temporarily unavailable",
        }),
      );
    }
  });

  app.post("/lobbies", async (request, reply) => {
    const parsed = CreateLobbyRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      return invalidRequest(reply);
    }

    try {
      const identity = await guestIdentity.resolve(request.headers.cookie);

      if (identity.setCookie) {
        reply.header("set-cookie", identity.setCookie);
      }

      const lobby = await lobbyService.create({
        ...parsed.data,
        participantId: identity.participantId,
      });

      return reply.code(201).send(LobbyResponseSchema.parse(lobby));
    } catch (error) {
      app.log.warn(
        { errorCode: readErrorCode(error) },
        "Lobby creation failed",
      );

      return reply.code(503).send(
        ApiErrorResponseSchema.parse({
          code: "LOBBY_SERVICE_UNAVAILABLE",
          message: "Lobby creation is temporarily unavailable",
        }),
      );
    }
  });

  app.post("/lobbies/join", async (request, reply) => {
    const parsed = JoinLobbyRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      return invalidRequest(reply);
    }

    try {
      const identity = await guestIdentity.resolve(request.headers.cookie);

      if (identity.setCookie) {
        reply.header("set-cookie", identity.setCookie);
      }

      return LobbyResponseSchema.parse(
        await lobbyService.join({
          ...parsed.data,
          participantId: identity.participantId,
        }),
      );
    } catch (error) {
      if (error instanceof LobbyUnavailableError) {
        return reply.code(404).send(
          ApiErrorResponseSchema.parse({
            code: "LOBBY_UNAVAILABLE",
            message: "This lobby cannot be joined",
          }),
        );
      }

      app.log.warn({ errorCode: readErrorCode(error) }, "Lobby join failed");

      return reply.code(503).send(
        ApiErrorResponseSchema.parse({
          code: "LOBBY_SERVICE_UNAVAILABLE",
          message: "Lobby join is temporarily unavailable",
        }),
      );
    }
  });

  app.get("/lobbies/:id", async (request, reply) => {
    const parsed = LobbyIdParameterSchema.safeParse(request.params);

    if (!parsed.success) {
      return invalidRequest(reply);
    }

    try {
      const identity = await guestIdentity.resolve(request.headers.cookie);

      if (identity.setCookie) {
        reply.header("set-cookie", identity.setCookie);
      }

      return LobbyResponseSchema.parse(
        await lobbyService.get(parsed.data.id, identity.participantId),
      );
    } catch (error) {
      if (error instanceof LobbyUnavailableError) {
        return reply.code(404).send(
          ApiErrorResponseSchema.parse({
            code: "LOBBY_NOT_FOUND",
            message: "This lobby is not available",
          }),
        );
      }

      app.log.warn(
        { errorCode: readErrorCode(error) },
        "Lobby retrieval failed",
      );

      return reply.code(503).send(
        ApiErrorResponseSchema.parse({
          code: "LOBBY_SERVICE_UNAVAILABLE",
          message: "Lobby retrieval is temporarily unavailable",
        }),
      );
    }
  });

  app.patch("/lobbies/:id/settings", async (request, reply) => {
    const parsedParameters = LobbyIdParameterSchema.safeParse(request.params);
    const parsedBody = UpdateLobbySettingsRequestSchema.safeParse(request.body);

    if (!parsedParameters.success || !parsedBody.success) {
      return invalidRequest(reply);
    }

    try {
      const identity = await guestIdentity.resolve(request.headers.cookie);
      const result = await lobbyService.updateSettings(
        parsedParameters.data.id,
        identity.participantId,
        parsedBody.data,
      );

      if (result.changed) {
        realtime.to(queueRoom(parsedParameters.data.id)).emit(
          "lobby:event",
          LobbyRealtimeEventSchema.parse({
            lobbyId: result.lobby.id,
            settings: result.lobby.settings,
            type: "lobby.settings.updated",
            version: result.lobby.version,
          }),
        );
      }

      return LobbyResponseSchema.parse(result.lobby);
    } catch (error) {
      if (error instanceof LobbySettingsCreatorRequiredError) {
        return reply.code(403).send(
          ApiErrorResponseSchema.parse({
            code: "LOBBY_CREATOR_REQUIRED",
            message: "Only the lobby creator can update its settings",
          }),
        );
      }

      if (error instanceof LobbyUnavailableError) {
        return reply.code(404).send(
          ApiErrorResponseSchema.parse({
            code: "LOBBY_NOT_FOUND",
            message: "This lobby is not available",
          }),
        );
      }

      app.log.warn(
        { errorCode: readErrorCode(error) },
        "Lobby settings update failed",
      );
      return reply.code(503).send(
        ApiErrorResponseSchema.parse({
          code: "LOBBY_SERVICE_UNAVAILABLE",
          message: "Lobby settings are temporarily unavailable",
        }),
      );
    }
  });

  app.delete("/lobbies/:id", async (request, reply) => {
    const parsed = LobbyIdParameterSchema.safeParse(request.params);

    if (!parsed.success) {
      return invalidRequest(reply);
    }

    try {
      const identity = await guestIdentity.resolve(request.headers.cookie);
      const result = CloseLobbyResponseSchema.parse(
        await lobbyLifecycleService.close(
          parsed.data.id,
          identity.participantId,
          async () => {
            try {
              await providerCatalog.purgeLobby?.(parsed.data.id);
            } catch (error) {
              app.log.warn(
                { errorCode: readErrorCode(error) },
                "Provider revocation during lobby closure failed",
              );
            }
          },
        ),
      );
      realtime.to(queueRoom(parsed.data.id)).emit(
        "lobby:event",
        LobbyRealtimeEventSchema.parse({
          lobbyId: parsed.data.id,
          type: "lobby.closed",
        }),
      );
      return result;
    } catch (error) {
      if (error instanceof LobbyCreatorRequiredError) {
        return reply.code(403).send(
          ApiErrorResponseSchema.parse({
            code: "LOBBY_CREATOR_REQUIRED",
            message: "Only the lobby creator can close it",
          }),
        );
      }

      if (error instanceof LobbyLifecycleUnavailableError) {
        return reply.code(404).send(
          ApiErrorResponseSchema.parse({
            code: "LOBBY_NOT_FOUND",
            message: "This lobby is not available",
          }),
        );
      }

      app.log.warn({ errorCode: readErrorCode(error) }, "Lobby closure failed");
      return reply.code(503).send(
        ApiErrorResponseSchema.parse({
          code: "LOBBY_SERVICE_UNAVAILABLE",
          message: "Lobby closure is temporarily unavailable",
        }),
      );
    }
  });

  app.get("/lobbies/:id/providers", async (request, reply) => {
    const parsed = LobbyIdParameterSchema.safeParse(request.params);

    if (!parsed.success) {
      return invalidRequest(reply);
    }

    try {
      const identity = await guestIdentity.resolve(request.headers.cookie);

      if (identity.setCookie) {
        reply.header("set-cookie", identity.setCookie);
      }

      await lobbyService.get(parsed.data.id, identity.participantId);
      return ProviderConnectionsResponseSchema.parse({
        connections: await providerCatalog.listForLobby(parsed.data.id),
      });
    } catch (error) {
      if (error instanceof LobbyUnavailableError) {
        return reply.code(404).send(
          ApiErrorResponseSchema.parse({
            code: "LOBBY_NOT_FOUND",
            message: "This lobby is not available",
          }),
        );
      }

      app.log.warn(
        { errorCode: readErrorCode(error) },
        "Provider catalog retrieval failed",
      );

      return reply.code(503).send(
        ApiErrorResponseSchema.parse({
          code: "PROVIDER_CATALOG_UNAVAILABLE",
          message: "Provider catalog is temporarily unavailable",
        }),
      );
    }
  });

  app.get("/lobbies/:id/search", async (request, reply) => {
    const parsedParameters = LobbyIdParameterSchema.safeParse(request.params);
    const parsedQuery = CatalogSearchQuerySchema.safeParse(request.query);

    if (!parsedParameters.success || !parsedQuery.success) {
      return invalidRequest(reply);
    }

    try {
      const identity = await guestIdentity.resolve(request.headers.cookie);

      if (identity.setCookie) {
        reply.header("set-cookie", identity.setCookie);
      }

      await lobbyService.get(parsedParameters.data.id, identity.participantId);
      return CatalogSearchResponseSchema.parse(
        await providerCatalog.searchForLobby(
          parsedParameters.data.id,
          parsedQuery.data,
        ),
      );
    } catch (error) {
      if (error instanceof LobbyUnavailableError) {
        return reply.code(404).send(
          ApiErrorResponseSchema.parse({
            code: "LOBBY_NOT_FOUND",
            message: "This lobby is not available",
          }),
        );
      }

      app.log.warn(
        { errorCode: readErrorCode(error) },
        "Catalog search failed",
      );

      return reply.code(503).send(
        ApiErrorResponseSchema.parse({
          code: "CATALOG_SEARCH_UNAVAILABLE",
          message: "Catalog search is temporarily unavailable",
        }),
      );
    }
  });

  app.get("/lobbies/:id/queue", async (request, reply) => {
    const parsed = LobbyIdParameterSchema.safeParse(request.params);

    if (!parsed.success) {
      return invalidRequest(reply);
    }

    try {
      const identity = await guestIdentity.resolve(request.headers.cookie);

      if (identity.setCookie) {
        reply.header("set-cookie", identity.setCookie);
      }

      return QueueSnapshotSchema.parse(
        await queueService.getSnapshot(parsed.data.id, identity.participantId),
      );
    } catch (error) {
      return handleQueueError(app, reply, error, "Queue retrieval failed");
    }
  });

  app.post("/lobbies/:id/queue/items", async (request, reply) => {
    const parsedParameters = LobbyIdParameterSchema.safeParse(request.params);
    const parsedBody = AddQueueItemRequestSchema.safeParse(request.body);

    if (!parsedParameters.success || !parsedBody.success) {
      return invalidRequest(reply);
    }

    try {
      const identity = await guestIdentity.resolve(request.headers.cookie);

      if (identity.setCookie) {
        reply.header("set-cookie", identity.setCookie);
      }

      const result = QueueMutationResponseSchema.parse(
        await queueService.add(
          parsedParameters.data.id,
          identity.participantId,
          parsedBody.data,
        ),
      );
      publishQueueMutation(realtime, result);
      return reply.code(201).send(result);
    } catch (error) {
      return handleQueueError(app, reply, error, "Queue addition failed");
    }
  });

  app.delete("/lobbies/:id/queue/items/:itemId", async (request, reply) => {
    const parsedParameters = QueueItemParameterSchema.safeParse(request.params);
    const parsedBody = RemoveQueueItemRequestSchema.safeParse(request.body);

    if (!parsedParameters.success || !parsedBody.success) {
      return invalidRequest(reply);
    }

    try {
      const identity = await guestIdentity.resolve(request.headers.cookie);

      if (identity.setCookie) {
        reply.header("set-cookie", identity.setCookie);
      }

      const result = QueueMutationResponseSchema.parse(
        await queueService.remove(
          parsedParameters.data.id,
          parsedParameters.data.itemId,
          identity.participantId,
          parsedBody.data,
        ),
      );
      publishQueueMutation(realtime, result);
      return result;
    } catch (error) {
      return handleQueueError(app, reply, error, "Queue removal failed");
    }
  });

  app.put("/lobbies/:id/queue/order", async (request, reply) => {
    const parsedParameters = LobbyIdParameterSchema.safeParse(request.params);
    const parsedBody = ReorderQueueRequestSchema.safeParse(request.body);

    if (!parsedParameters.success || !parsedBody.success) {
      return invalidRequest(reply);
    }

    try {
      const identity = await guestIdentity.resolve(request.headers.cookie);

      if (identity.setCookie) {
        reply.header("set-cookie", identity.setCookie);
      }

      const result = QueueMutationResponseSchema.parse(
        await queueService.reorder(
          parsedParameters.data.id,
          identity.participantId,
          parsedBody.data,
        ),
      );
      publishQueueMutation(realtime, result);
      return result;
    } catch (error) {
      return handleQueueError(app, reply, error, "Queue reorder failed");
    }
  });

  app.get("/lobbies/:id/player", async (request, reply) => {
    const parsedParameters = LobbyIdParameterSchema.safeParse(request.params);
    const parsedQuery = PlayerSnapshotQuerySchema.safeParse(request.query);

    if (!parsedParameters.success || !parsedQuery.success) {
      return invalidRequest(reply);
    }

    try {
      const identity = await guestIdentity.resolve(request.headers.cookie);
      return PlayerSnapshotSchema.parse(
        await playbackService.getSnapshot(
          parsedParameters.data.id,
          identity.participantId,
          parsedQuery.data.deviceId,
        ),
      );
    } catch (error) {
      return handlePlayerError(app, reply, error, "Player retrieval failed");
    }
  });

  app.post("/lobbies/:id/player/claim", async (request, reply) => {
    const parsedParameters = LobbyIdParameterSchema.safeParse(request.params);
    const parsedBody = ClaimPlayerRequestSchema.safeParse(request.body);

    if (!parsedParameters.success || !parsedBody.success) {
      return invalidRequest(reply);
    }

    try {
      const identity = await guestIdentity.resolve(request.headers.cookie);
      const result = PlayerMutationResponseSchema.parse(
        await playbackService.claim(
          parsedParameters.data.id,
          identity.participantId,
          parsedBody.data,
        ),
      );
      publishPlaybackMutation(realtime, result);
      return result;
    } catch (error) {
      return handlePlayerError(app, reply, error, "Player claim failed");
    }
  });

  app.post("/lobbies/:id/player/heartbeat", async (request, reply) => {
    const parsedParameters = LobbyIdParameterSchema.safeParse(request.params);
    const parsedBody = PlayerHeartbeatRequestSchema.safeParse(request.body);

    if (!parsedParameters.success || !parsedBody.success) {
      return invalidRequest(reply);
    }

    try {
      const identity = await guestIdentity.resolve(request.headers.cookie);
      return PlayerMutationResponseSchema.parse(
        await playbackService.heartbeat(
          parsedParameters.data.id,
          identity.participantId,
          parsedBody.data,
        ),
      );
    } catch (error) {
      return handlePlayerError(app, reply, error, "Player heartbeat failed");
    }
  });

  app.post("/lobbies/:id/playback/:command", async (request, reply) => {
    const parsedParameters = PlaybackCommandParameterSchema.safeParse(
      request.params,
    );
    const parsedBody = PlaybackControlRequestSchema.safeParse(request.body);

    if (!parsedParameters.success || !parsedBody.success) {
      return invalidRequest(reply);
    }

    try {
      const identity = await guestIdentity.resolve(request.headers.cookie);
      const result = PlayerMutationResponseSchema.parse(
        await playbackService.control(
          parsedParameters.data.id,
          identity.participantId,
          parsedParameters.data.command,
          parsedBody.data,
        ),
      );
      publishPlaybackMutation(realtime, result);
      await publishQueueAfterPlayback(
        app,
        realtime,
        queueService,
        identity.participantId,
        result,
      );
      return result;
    } catch (error) {
      return handlePlayerError(app, reply, error, "Playback command failed");
    }
  });

  app.post("/lobbies/:id/playback/report", async (request, reply) => {
    const parsedParameters = LobbyIdParameterSchema.safeParse(request.params);
    const parsedBody = PlaybackReportRequestSchema.safeParse(request.body);

    if (!parsedParameters.success || !parsedBody.success) {
      return invalidRequest(reply);
    }

    try {
      const identity = await guestIdentity.resolve(request.headers.cookie);
      const result = PlayerMutationResponseSchema.parse(
        await playbackService.report(
          parsedParameters.data.id,
          identity.participantId,
          parsedBody.data,
        ),
      );
      publishPlaybackMutation(realtime, result);
      await publishQueueAfterPlayback(
        app,
        realtime,
        queueService,
        identity.participantId,
        result,
      );
      return result;
    } catch (error) {
      return handlePlayerError(app, reply, error, "Playback report failed");
    }
  });

  app.addHook("onClose", async () => {
    await new Promise<void>((resolve) => realtime.close(() => resolve()));
    await database.end();
  });

  return app;
}

const unavailableQueueService = {
  async add(): Promise<never> {
    throw new Error("Queue service is unavailable");
  },
  async getSnapshot(): Promise<never> {
    throw new Error("Queue service is unavailable");
  },
  async remove(): Promise<never> {
    throw new Error("Queue service is unavailable");
  },
  async reorder(): Promise<never> {
    throw new Error("Queue service is unavailable");
  },
};

const unavailableLobbyLifecycleService = {
  async close(): Promise<never> {
    throw new Error("Lobby lifecycle service is unavailable");
  },
};

const unavailablePlaybackService = {
  async claim(): Promise<never> {
    throw new Error("Playback service is unavailable");
  },
  async control(): Promise<never> {
    throw new Error("Playback service is unavailable");
  },
  async getSnapshot(): Promise<never> {
    throw new Error("Playback service is unavailable");
  },
  async heartbeat(): Promise<never> {
    throw new Error("Playback service is unavailable");
  },
  async report(): Promise<never> {
    throw new Error("Playback service is unavailable");
  },
};

function publishQueueMutation(
  realtime: SocketServer,
  result: ReturnType<typeof QueueMutationResponseSchema.parse>,
) {
  if (result.replayed) {
    return;
  }

  realtime.to(queueRoom(result.snapshot.lobbyId)).emit(
    "queue:event",
    QueueRealtimeEventSchema.parse({
      snapshot: result.snapshot,
      type: "queue.updated",
    }),
  );
}

function publishPlaybackMutation(
  realtime: SocketServer,
  result: ReturnType<typeof PlayerMutationResponseSchema.parse>,
) {
  if (result.replayed) {
    return;
  }

  realtime.to(queueRoom(result.snapshot.lobbyId)).emit(
    "playback:event",
    PlaybackRealtimeEventSchema.parse({
      lobbyId: result.snapshot.lobbyId,
      type: "playback.updated",
      version: result.snapshot.version,
    }),
  );
}

async function publishQueueAfterPlayback(
  app: ReturnType<typeof Fastify>,
  realtime: SocketServer,
  queueService: Pick<QueueService, "getSnapshot">,
  participantId: string,
  result: ReturnType<typeof PlayerMutationResponseSchema.parse>,
) {
  if (!result.queueChanged || result.replayed) {
    return;
  }

  try {
    publishQueueMutation(realtime, {
      replayed: false,
      snapshot: await queueService.getSnapshot(
        result.snapshot.lobbyId,
        participantId,
      ),
    });
  } catch (error) {
    app.log.warn(
      { errorCode: readErrorCode(error) },
      "Queue publication after playback failed",
    );
  }
}

function queueRoom(lobbyId: string) {
  return `lobby:${lobbyId}`;
}

function handleQueueError(
  app: ReturnType<typeof Fastify>,
  reply: {
    code(statusCode: number): { send(payload: unknown): unknown };
  },
  error: unknown,
  logMessage: string,
) {
  if (error instanceof QueueAccessError) {
    return reply.code(404).send(
      QueueErrorResponseSchema.parse({
        code: "LOBBY_NOT_FOUND",
        message: "This lobby is not available",
      }),
    );
  }

  if (error instanceof QueueConflictError) {
    const statusCode = error.code === "QUEUE_ITEM_NOT_FOUND" ? 404 : 409;
    return reply.code(statusCode).send(
      QueueErrorResponseSchema.parse({
        code: error.code,
        message: queueConflictMessage(error.code),
        ...(error.snapshot ? { snapshot: error.snapshot } : {}),
      }),
    );
  }

  app.log.warn({ errorCode: readErrorCode(error) }, logMessage);
  return reply.code(503).send(
    QueueErrorResponseSchema.parse({
      code: "QUEUE_UNAVAILABLE",
      message: "The queue is temporarily unavailable",
    }),
  );
}

function handlePlayerError(
  app: ReturnType<typeof Fastify>,
  reply: {
    code(statusCode: number): { send(payload: unknown): unknown };
  },
  error: unknown,
  logMessage: string,
) {
  if (error instanceof PlayerAccessError) {
    return reply.code(404).send(
      PlayerErrorResponseSchema.parse({
        code: "LOBBY_NOT_FOUND",
        message: "This lobby is not available",
      }),
    );
  }

  if (error instanceof PlayerConflictError) {
    return reply.code(409).send(
      PlayerErrorResponseSchema.parse({
        code: error.code,
        message: playerConflictMessage(error.code),
        ...(error.snapshot ? { snapshot: error.snapshot } : {}),
      }),
    );
  }

  app.log.warn({ errorCode: readErrorCode(error) }, logMessage);
  return reply.code(503).send(
    PlayerErrorResponseSchema.parse({
      code: "PLAYBACK_UNAVAILABLE",
      message: "Playback is temporarily unavailable",
    }),
  );
}

function playerConflictMessage(code: PlayerConflictError["code"]): string {
  return {
    IDEMPOTENCY_KEY_REUSED: "This command identifier was already used",
    LEASE_HELD: "Another browser currently holds the player lease",
    LEASE_LOST: "The player lease is no longer available",
    PLAYBACK_COMMAND_REJECTED: "This command does not match playback state",
    QUEUE_EMPTY: "The queue does not contain a playable title",
  }[code];
}

function queueConflictMessage(code: QueueConflictError["code"]): string {
  return {
    BLIND_TEST_QUEUE_HIDDEN:
      "The queue cannot be managed while blind test mode is enabled",
    IDEMPOTENCY_KEY_REUSED: "This command identifier was already used",
    QUEUE_FULL: "The queue is full",
    QUEUE_ITEM_NOT_FOUND: "This queue item is not available",
    QUEUE_ITEM_SET_CONFLICT: "The queue contents changed",
    QUEUE_VERSION_CONFLICT: "The queue changed before this command",
    TRACK_NOT_AUTHORIZED: "This track is not authorized for the lobby",
  }[code];
}

function invalidRequest(reply: {
  code(statusCode: number): { send(payload: unknown): unknown };
}) {
  return reply.code(400).send(
    ApiErrorResponseSchema.parse({
      code: "INVALID_REQUEST",
      message: "The request contains invalid fields",
    }),
  );
}

function readErrorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }

  return "unknown";
}
