import type { ProviderCapability } from "@easyplaylist/contracts";

import {
  ProviderCredentialsExpiredError,
  ProviderCredentialsRevokedError,
  ProviderTrackUnavailableError,
  ProviderUnavailableError,
  type CredentialReport,
  type MusicProviderAdapter,
  type PlaybackCommand,
  type PlaybackReport,
  type PlayableVariant,
  type ProviderConnectionRef,
  type SearchPage,
  type SearchQuery,
  type TrackCandidate,
} from "./music-provider.js";

export type FakeProviderScenario =
  "success" | "partial_failure" | "expired" | "unavailable";

interface FakeMusicProviderOptions {
  clock?: () => number;
  scenario?: FakeProviderScenario;
}

interface FakePlayback {
  commandId: string;
  durationMs: number;
  positionMs: number;
  startedAt: number;
  state: "playing" | "paused" | "ended" | "skipped";
}

export const fakeProviderCapabilities = [
  "catalog_search",
  "track_metadata",
  "web_playback",
  "pause_resume",
  "queue_control",
  "token_refresh",
  "token_revoke",
] as const satisfies readonly ProviderCapability[];

export class FakeMusicProviderAdapter implements MusicProviderAdapter {
  readonly provider = "fake";

  private readonly clock: () => number;
  private credentialStatus: CredentialReport;
  private playback: FakePlayback | undefined;
  private readonly scenario: FakeProviderScenario;

  constructor(options: FakeMusicProviderOptions = {}) {
    this.clock = options.clock ?? Date.now;
    this.scenario = options.scenario ?? "success";
    this.credentialStatus = {
      expiresAt:
        this.scenario === "expired"
          ? new Date(this.clock() - 1_000)
          : new Date(this.clock() + 3_600_000),
      status: this.scenario === "expired" ? "expired" : "active",
    };
  }

  async getCapabilities(
    _connection: ProviderConnectionRef,
  ): Promise<readonly ProviderCapability[]> {
    return fakeProviderCapabilities;
  }

  async getCredentialStatus(
    _connection: ProviderConnectionRef,
  ): Promise<CredentialReport> {
    if (this.scenario === "unavailable") {
      return { expiresAt: null, status: "unavailable" };
    }

    return this.credentialStatus;
  }

  async search(
    query: SearchQuery,
    _connection: ProviderConnectionRef,
  ): Promise<SearchPage> {
    this.assertOperational();
    const slug = slugify(query.text);
    const results = fakeTracks
      .map((track, index) => ({
        ...track,
        providerTrackId: `fake:${slug}:${index + 1}`,
        title: `${query.text.trim()} · ${track.title}`,
      }))
      .slice(0, query.limit);

    return {
      issues:
        this.scenario === "partial_failure"
          ? [
              {
                code: "FAKE_CATALOG_SHARD_UNAVAILABLE",
                message: "One simulated catalog shard did not answer",
                retryable: true,
              },
            ]
          : [],
      nextCursor: null,
      results,
    };
  }

  async resolve(
    candidate: TrackCandidate,
    _connection: ProviderConnectionRef,
  ): Promise<PlayableVariant> {
    this.assertOperational();

    if (
      candidate.provider !== this.provider ||
      candidate.providerTrackId === "fake:unavailable"
    ) {
      throw new ProviderTrackUnavailableError(
        "The simulated track is unavailable",
      );
    }

    return {
      durationMs: candidate.durationMs,
      playbackRef: `fake-playback:${candidate.providerTrackId}`,
      provider: this.provider,
      providerTrackId: candidate.providerTrackId,
    };
  }

  async start(
    command: PlaybackCommand,
    _connection: ProviderConnectionRef,
  ): Promise<PlaybackReport> {
    this.assertOperational();
    this.playback = {
      commandId: command.commandId,
      durationMs: command.variant.durationMs,
      positionMs: 0,
      startedAt: this.clock(),
      state: "playing",
    };
    return this.reportPlayback(command.commandId);
  }

  async pause(
    command: PlaybackCommand,
    _connection: ProviderConnectionRef,
  ): Promise<PlaybackReport> {
    this.assertOperational();
    const report = this.reportPlayback(command.commandId);
    this.playback = {
      ...this.requirePlayback(command.commandId),
      positionMs: report.positionMs,
      state: "paused",
    };
    return this.reportPlayback(command.commandId);
  }

  async resume(
    command: PlaybackCommand,
    _connection: ProviderConnectionRef,
  ): Promise<PlaybackReport> {
    this.assertOperational();
    const playback = this.requirePlayback(command.commandId);
    this.playback = {
      ...playback,
      startedAt: this.clock(),
      state: "playing",
    };
    return this.reportPlayback(command.commandId);
  }

  async skip(
    command: PlaybackCommand,
    _connection: ProviderConnectionRef,
  ): Promise<PlaybackReport> {
    this.assertOperational();
    const playback = this.requirePlayback(command.commandId);
    this.playback = { ...playback, state: "skipped" };
    return this.reportPlayback(command.commandId);
  }

  async getPlaybackReport(
    commandId: string,
    _connection: ProviderConnectionRef,
  ): Promise<PlaybackReport> {
    this.assertOperational();
    return this.reportPlayback(commandId);
  }

  async refreshCredentials(
    _connection: ProviderConnectionRef,
  ): Promise<CredentialReport> {
    if (this.scenario === "unavailable") {
      throw new ProviderUnavailableError("The fake provider is unavailable");
    }

    if (this.credentialStatus.status === "revoked") {
      throw new ProviderCredentialsRevokedError(
        "The simulated credentials were revoked",
      );
    }

    this.credentialStatus = {
      expiresAt: new Date(this.clock() + 3_600_000),
      status: "active",
    };
    return this.credentialStatus;
  }

  async revokeCredentials(_connection: ProviderConnectionRef): Promise<void> {
    this.credentialStatus = { expiresAt: null, status: "revoked" };
  }

  private assertOperational(): void {
    if (this.scenario === "unavailable") {
      throw new ProviderUnavailableError("The fake provider is unavailable");
    }

    if (this.credentialStatus.status === "expired") {
      throw new ProviderCredentialsExpiredError(
        "The simulated credentials expired",
      );
    }

    if (this.credentialStatus.status === "revoked") {
      throw new ProviderCredentialsRevokedError(
        "The simulated credentials were revoked",
      );
    }
  }

  private reportPlayback(commandId: string): PlaybackReport {
    const playback = this.requirePlayback(commandId);

    if (playback.state === "playing") {
      const positionMs = Math.min(
        playback.durationMs,
        playback.positionMs + Math.max(0, this.clock() - playback.startedAt),
      );

      if (positionMs >= playback.durationMs) {
        this.playback = { ...playback, positionMs, state: "ended" };
      }
    }

    const current = this.requirePlayback(commandId);
    return {
      commandId: current.commandId,
      positionMs:
        current.state === "playing"
          ? Math.min(
              current.durationMs,
              current.positionMs +
                Math.max(0, this.clock() - current.startedAt),
            )
          : current.positionMs,
      state: current.state,
    };
  }

  private requirePlayback(commandId: string): FakePlayback {
    if (!this.playback || this.playback.commandId !== commandId) {
      throw new Error("No simulated playback exists for this command");
    }

    return this.playback;
  }
}

const fakeTracks: readonly Omit<TrackCandidate, "providerTrackId">[] = [
  {
    album: "Neon Rooms",
    artists: ["The Determinists"],
    durationMs: 180_000,
    explicit: false,
    imageUrl: null,
    isrc: "FAKE00000001",
    provider: "fake",
    title: "Midnight Relay",
  },
  {
    album: "Shared Signals",
    artists: ["Static Friends"],
    durationMs: 205_000,
    explicit: false,
    imageUrl: null,
    isrc: "FAKE00000002",
    provider: "fake",
    title: "Same Room",
  },
  {
    album: "Last Call",
    artists: ["Queue Theory"],
    durationMs: 142_000,
    explicit: true,
    imageUrl: null,
    isrc: "FAKE00000003",
    provider: "fake",
    title: "One More Song",
  },
];

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
}
