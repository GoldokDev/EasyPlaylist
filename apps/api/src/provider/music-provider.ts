import type { ProviderCapability } from "@easyplaylist/contracts";

export type ProviderCredentialStatus =
  "active" | "expired" | "revoked" | "unavailable";

export interface ProviderConnectionRef {
  capabilities: readonly ProviderCapability[];
  id: string;
  lobbyId: string;
  provider: string;
}

export interface SearchQuery {
  cursor?: string;
  limit: number;
  text: string;
}

export interface ProviderIssue {
  code: string;
  message: string;
  retryable: boolean;
}

export interface TrackCandidate {
  album: string;
  artists: readonly string[];
  durationMs: number;
  explicit: boolean;
  imageUrl: string | null;
  isrc: string | null;
  provider: string;
  providerTrackId: string;
  title: string;
}

export interface SearchPage {
  issues: readonly ProviderIssue[];
  nextCursor: string | null;
  results: readonly TrackCandidate[];
}

export interface PlayableVariant {
  durationMs: number;
  provider: string;
  providerTrackId: string;
  playbackRef: string;
}

export interface PlaybackCommand {
  commandId: string;
  variant: PlayableVariant;
}

export interface PlaybackReport {
  commandId: string;
  positionMs: number;
  state: "playing" | "paused" | "ended" | "skipped";
}

export interface CredentialReport {
  expiresAt: Date | null;
  status: ProviderCredentialStatus;
}

export interface MusicProviderAdapter {
  readonly provider: string;

  getCapabilities(
    connection: ProviderConnectionRef,
  ): Promise<readonly ProviderCapability[]>;
  getCredentialStatus(
    connection: ProviderConnectionRef,
  ): Promise<CredentialReport>;
  search(
    query: SearchQuery,
    connection: ProviderConnectionRef,
  ): Promise<SearchPage>;
  resolve(
    candidate: TrackCandidate,
    connection: ProviderConnectionRef,
  ): Promise<PlayableVariant>;
  start(
    command: PlaybackCommand,
    connection: ProviderConnectionRef,
  ): Promise<PlaybackReport>;
  pause(
    command: PlaybackCommand,
    connection: ProviderConnectionRef,
  ): Promise<PlaybackReport>;
  resume(
    command: PlaybackCommand,
    connection: ProviderConnectionRef,
  ): Promise<PlaybackReport>;
  skip(
    command: PlaybackCommand,
    connection: ProviderConnectionRef,
  ): Promise<PlaybackReport>;
  getPlaybackReport(
    commandId: string,
    connection: ProviderConnectionRef,
  ): Promise<PlaybackReport>;
  refreshCredentials(
    connection: ProviderConnectionRef,
  ): Promise<CredentialReport>;
  revokeCredentials(connection: ProviderConnectionRef): Promise<void>;
}

export class ProviderCapabilityUnavailableError extends Error {
  readonly code = "PROVIDER_CAPABILITY_UNAVAILABLE";

  constructor(readonly capability: ProviderCapability) {
    super(`Provider capability is unavailable: ${capability}`);
  }
}

export class ProviderCredentialsExpiredError extends Error {
  readonly code = "PROVIDER_CREDENTIALS_EXPIRED";
}

export class ProviderCredentialsRevokedError extends Error {
  readonly code = "PROVIDER_CREDENTIALS_REVOKED";
}

export class ProviderUnavailableError extends Error {
  readonly code = "PROVIDER_UNAVAILABLE";
}

export class ProviderTrackUnavailableError extends Error {
  readonly code = "PROVIDER_TRACK_UNAVAILABLE";
}

export class CapabilityAwareMusicProvider {
  constructor(
    private readonly adapter: MusicProviderAdapter,
    private readonly connection: ProviderConnectionRef,
  ) {
    if (adapter.provider !== connection.provider) {
      throw new Error("Provider adapter and connection do not match");
    }
  }

  getCapabilities(): readonly ProviderCapability[] {
    return this.connection.capabilities;
  }

  getCredentialStatus(): Promise<CredentialReport> {
    return this.adapter.getCredentialStatus(this.connection);
  }

  search(query: SearchQuery): Promise<SearchPage> {
    this.requireCapability("catalog_search");
    return this.adapter.search(query, this.connection);
  }

  resolve(candidate: TrackCandidate): Promise<PlayableVariant> {
    this.requireCapability("track_metadata");
    return this.adapter.resolve(candidate, this.connection);
  }

  start(command: PlaybackCommand): Promise<PlaybackReport> {
    this.requireCapability("web_playback");
    return this.adapter.start(command, this.connection);
  }

  pause(command: PlaybackCommand): Promise<PlaybackReport> {
    this.requireCapability("pause_resume");
    return this.adapter.pause(command, this.connection);
  }

  resume(command: PlaybackCommand): Promise<PlaybackReport> {
    this.requireCapability("pause_resume");
    return this.adapter.resume(command, this.connection);
  }

  skip(command: PlaybackCommand): Promise<PlaybackReport> {
    this.requireCapability("queue_control");
    return this.adapter.skip(command, this.connection);
  }

  getPlaybackReport(commandId: string): Promise<PlaybackReport> {
    this.requireCapability("web_playback");
    return this.adapter.getPlaybackReport(commandId, this.connection);
  }

  refreshCredentials(): Promise<CredentialReport> {
    this.requireCapability("token_refresh");
    return this.adapter.refreshCredentials(this.connection);
  }

  async revokeCredentials(): Promise<void> {
    this.requireCapability("token_revoke");
    await this.adapter.revokeCredentials(this.connection);
  }

  private requireCapability(capability: ProviderCapability): void {
    if (!this.connection.capabilities.includes(capability)) {
      throw new ProviderCapabilityUnavailableError(capability);
    }
  }
}
