import { Pool } from "pg";

import { buildApp } from "./app.js";
import { GuestIdentityManager } from "./identity/guest-identity.js";
import { LobbyLifecycleService } from "./lobby/lobby-lifecycle-service.js";
import { LobbyService } from "./lobby/lobby-service.js";
import { runMigrations } from "./persistence/migrations.js";
import { PlaybackService } from "./playback/playback-service.js";
import { ProviderCatalog } from "./provider/provider-catalog.js";
import { QueueService } from "./queue/queue-service.js";
import { createSecretVaultFromEnvironment } from "./security/secret-vault.js";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const host = process.env.HOST ?? "127.0.0.1";
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://easyplaylist:local-development-only@127.0.0.1:5432/easyplaylist";

const database = new Pool({
  connectionString: databaseUrl,
  connectionTimeoutMillis: 2_000,
  max: 4,
});

const guestCookieSigningKey = process.env.GUEST_COOKIE_SIGNING_KEY;

if (!guestCookieSigningKey) {
  throw new Error("GUEST_COOKIE_SIGNING_KEY is required");
}

const cookieSecure = parseBoolean(
  process.env.COOKIE_SECURE,
  process.env.NODE_ENV === "production",
);
const lobbyTtlHours = parsePositiveInteger(
  "LOBBY_TTL_HOURS",
  process.env.LOBBY_TTL_HOURS,
  24,
);
const expirationSweepIntervalMs = parsePositiveInteger(
  "LOBBY_EXPIRATION_SWEEP_INTERVAL_MS",
  process.env.LOBBY_EXPIRATION_SWEEP_INTERVAL_MS,
  60_000,
);
const expirationBatchSize = parsePositiveInteger(
  "LOBBY_EXPIRATION_BATCH_SIZE",
  process.env.LOBBY_EXPIRATION_BATCH_SIZE,
  100,
);
const guestIdentity = new GuestIdentityManager({
  cookieSecure,
  database,
  signingKey: Buffer.from(guestCookieSigningKey, "utf8"),
});
const lobbyService = new LobbyService({ database, ttlHours: lobbyTtlHours });
const lobbyLifecycleService = new LobbyLifecycleService({ database });
const providerCatalog = new ProviderCatalog({
  ...(process.env.YOUTUBE_API_KEY
    ? { youtubeApiKey: process.env.YOUTUBE_API_KEY }
    : {}),
  youtubeRegionCode: process.env.YOUTUBE_REGION_CODE ?? "FR",
});
const queueService = new QueueService({
  database,
  isTrackAuthorized: (lobbyId, track) =>
    providerCatalog.isTrackAuthorizedForLobby(lobbyId, track),
});
const playbackService = new PlaybackService({
  database,
  getPlaybackSource: (lobbyId, track) =>
    providerCatalog.getPlaybackSourceForLobby(lobbyId, track),
});
const secretVault = createSecretVaultFromEnvironment(process.env);
const vaultProbe = secretVault.encrypt("startup-probe");

if (secretVault.decrypt(vaultProbe) !== "startup-probe") {
  throw new Error("Secret vault startup probe failed");
}

const app = buildApp({
  database,
  guestIdentity,
  lobbyLifecycleService,
  lobbyService,
  playbackService,
  providerCatalog,
  queueService,
});
let expirationSweepRunning = false;
let expirationTimer: NodeJS.Timeout | undefined;

database.on("error", (error) => {
  const databaseError = error as Error & { code?: string };

  app.log.warn(
    { databaseErrorCode: databaseError.code ?? "unknown" },
    "Unexpected PostgreSQL pool error",
  );
});

const shutdown = async (signal: NodeJS.Signals) => {
  app.log.info({ signal }, "Stopping API");
  if (expirationTimer) {
    clearInterval(expirationTimer);
  }
  await app.close();
  process.exit(0);
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await runMigrations(database);
  await sweepExpiredLobbies();
  await app.listen({ host, port });
  expirationTimer = setInterval(
    () => void sweepExpiredLobbies(),
    expirationSweepIntervalMs,
  );
  expirationTimer.unref();
} catch (error) {
  app.log.error(error, "API failed to start");
  process.exit(1);
}

async function sweepExpiredLobbies() {
  if (expirationSweepRunning) {
    return;
  }

  expirationSweepRunning = true;

  try {
    const result = await lobbyLifecycleService.expireBatch(expirationBatchSize);

    if (result.processedCount > 0) {
      app.log.info(
        {
          expiredLobbyCount: result.expiredLobbyIds.length,
          processedLobbyCount: result.processedCount,
          purgedProviderConnectionCount: result.purgedConnectionCount,
        },
        "Lobby expiration sweep completed",
      );
    }
  } catch (error) {
    app.log.error(
      { errorCode: readErrorCode(error) },
      "Lobby expiration sweep failed",
    );
  } finally {
    expirationSweepRunning = false;
  }
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error("COOKIE_SECURE must be true or false");
}

function parsePositiveInteger(
  name: string,
  value: string | undefined,
  fallback: number,
): number {
  const parsed = value === undefined ? fallback : Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function readErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    return String(error.code);
  }

  return "unknown";
}
