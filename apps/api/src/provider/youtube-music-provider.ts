import type { ProviderCapability } from "@easyplaylist/contracts";

import {
  ProviderCapabilityUnavailableError,
  ProviderTrackUnavailableError,
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

interface YoutubeMusicProviderOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  regionCode?: string;
}

interface YoutubePlayback {
  commandId: string;
  state: PlaybackReport["state"];
}

interface YoutubeSearchItem {
  id?: { videoId?: string };
  snippet?: {
    channelTitle?: string;
    thumbnails?: Record<string, { url?: string }>;
    title?: string;
  };
}

interface YoutubeVideoItem {
  contentDetails?: { duration?: string };
  id?: string;
  status?: { embeddable?: boolean };
}

export const youtubeProviderCapabilities = [
  "catalog_search",
  "track_metadata",
  "web_playback",
  "pause_resume",
  "queue_control",
] as const satisfies readonly ProviderCapability[];

export const youtubePlaybackCapabilities = [
  "web_playback",
  "pause_resume",
  "queue_control",
] as const satisfies readonly ProviderCapability[];

export class YoutubeMusicProviderAdapter implements MusicProviderAdapter {
  readonly provider = "youtube";

  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly playbacks = new Map<string, YoutubePlayback>();
  private readonly regionCode: string | undefined;

  constructor(options: YoutubeMusicProviderOptions = {}) {
    const apiKey = options.apiKey?.trim();
    const regionCode = options.regionCode?.trim().toUpperCase();

    this.apiKey = apiKey || undefined;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.regionCode =
      regionCode && /^[A-Z]{2}$/.test(regionCode) ? regionCode : undefined;
  }

  isConfigured(): boolean {
    return this.apiKey !== undefined;
  }

  async getCapabilities(
    connection: ProviderConnectionRef,
  ): Promise<readonly ProviderCapability[]> {
    return connection.capabilities;
  }

  async getCredentialStatus(
    _connection: ProviderConnectionRef,
  ): Promise<CredentialReport> {
    return {
      expiresAt: null,
      status: this.isConfigured() ? "active" : "unavailable",
    };
  }

  async search(
    query: SearchQuery,
    _connection: ProviderConnectionRef,
  ): Promise<SearchPage> {
    const apiKey = this.requireApiKey();
    const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
    searchUrl.search = new URLSearchParams({
      key: apiKey,
      maxResults: String(Math.min(query.limit, 20)),
      part: "snippet",
      q: query.text,
      safeSearch: "moderate",
      type: "video",
      videoCategoryId: "10",
      videoEmbeddable: "true",
      videoSyndicated: "true",
    }).toString();

    if (query.cursor) {
      searchUrl.searchParams.set("pageToken", query.cursor);
    }

    if (this.regionCode) {
      searchUrl.searchParams.set("regionCode", this.regionCode);
    }

    const searchPayload = await this.request(searchUrl);
    const searchItems = readArray<YoutubeSearchItem>(searchPayload, "items");
    const videoIds = searchItems
      .map((item) => item.id?.videoId)
      .filter(isYoutubeVideoId);

    if (videoIds.length === 0) {
      return {
        issues: [],
        nextCursor: readBoundedString(searchPayload, "nextPageToken", 200),
        results: [],
      };
    }

    const detailsUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
    detailsUrl.search = new URLSearchParams({
      id: videoIds.join(","),
      key: apiKey,
      part: "contentDetails,status",
    }).toString();
    const detailsPayload = await this.request(detailsUrl);
    const details = new Map(
      readArray<YoutubeVideoItem>(detailsPayload, "items")
        .filter((item): item is YoutubeVideoItem & { id: string } =>
          isYoutubeVideoId(item.id),
        )
        .map((item) => [item.id, item]),
    );
    const results = searchItems.flatMap((item): TrackCandidate[] => {
      const videoId = item.id?.videoId;
      const detail = videoId ? details.get(videoId) : undefined;
      const title = decodeYoutubeText(item.snippet?.title ?? "").trim();
      const channel = decodeYoutubeText(
        item.snippet?.channelTitle ?? "",
      ).trim();
      const durationMs = parseYoutubeDuration(detail?.contentDetails?.duration);

      if (
        !isYoutubeVideoId(videoId) ||
        detail?.status?.embeddable !== true ||
        !title ||
        !channel ||
        durationMs === null ||
        durationMs > 86_400_000
      ) {
        return [];
      }

      return [
        {
          album: channel,
          artists: [channel],
          durationMs,
          explicit: false,
          imageUrl: readThumbnail(item.snippet?.thumbnails),
          isrc: null,
          provider: this.provider,
          providerTrackId: videoId,
          title,
        },
      ];
    });

    return {
      issues: [],
      nextCursor: readBoundedString(searchPayload, "nextPageToken", 200),
      results,
    };
  }

  async resolve(
    candidate: TrackCandidate,
    _connection: ProviderConnectionRef,
  ): Promise<PlayableVariant> {
    if (
      candidate.provider !== this.provider ||
      !isYoutubeVideoId(candidate.providerTrackId)
    ) {
      throw new ProviderTrackUnavailableError(
        "The YouTube video cannot be embedded",
      );
    }

    return {
      durationMs: candidate.durationMs,
      playbackRef: candidate.providerTrackId,
      provider: this.provider,
      providerTrackId: candidate.providerTrackId,
    };
  }

  async start(
    command: PlaybackCommand,
    _connection: ProviderConnectionRef,
  ): Promise<PlaybackReport> {
    this.playbacks.set(command.commandId, {
      commandId: command.commandId,
      state: "playing",
    });
    return this.report(command.commandId);
  }

  async pause(
    command: PlaybackCommand,
    _connection: ProviderConnectionRef,
  ): Promise<PlaybackReport> {
    this.requirePlayback(command.commandId).state = "paused";
    return this.report(command.commandId);
  }

  async resume(
    command: PlaybackCommand,
    _connection: ProviderConnectionRef,
  ): Promise<PlaybackReport> {
    this.requirePlayback(command.commandId).state = "playing";
    return this.report(command.commandId);
  }

  async skip(
    command: PlaybackCommand,
    _connection: ProviderConnectionRef,
  ): Promise<PlaybackReport> {
    this.requirePlayback(command.commandId).state = "skipped";
    return this.report(command.commandId);
  }

  async getPlaybackReport(
    commandId: string,
    _connection: ProviderConnectionRef,
  ): Promise<PlaybackReport> {
    return this.report(commandId);
  }

  async refreshCredentials(
    connection: ProviderConnectionRef,
  ): Promise<CredentialReport> {
    if (!connection.capabilities.includes("token_refresh")) {
      throw new ProviderCapabilityUnavailableError("token_refresh");
    }

    return this.getCredentialStatus(connection);
  }

  async revokeCredentials(connection: ProviderConnectionRef): Promise<void> {
    if (!connection.capabilities.includes("token_revoke")) {
      throw new ProviderCapabilityUnavailableError("token_revoke");
    }
  }

  private requireApiKey(): string {
    if (!this.apiKey) {
      throw new YoutubeProviderError(
        "YOUTUBE_NOT_CONFIGURED",
        "YouTube Data API is not configured",
      );
    }

    return this.apiKey;
  }

  private async request(url: URL): Promise<Record<string, unknown>> {
    let response: Response;

    try {
      response = await this.fetchImpl(url, {
        signal: AbortSignal.timeout(1_800),
      });
    } catch {
      throw new YoutubeProviderError(
        "YOUTUBE_REQUEST_FAILED",
        "YouTube did not answer",
      );
    }

    if (!response.ok) {
      throw new YoutubeProviderError(
        response.status === 403 || response.status === 429
          ? "YOUTUBE_QUOTA_OR_ACCESS_DENIED"
          : "YOUTUBE_REQUEST_FAILED",
        "YouTube rejected the catalog request",
      );
    }

    try {
      const payload: unknown = await response.json();

      if (typeof payload !== "object" || payload === null) {
        throw new Error("Invalid payload");
      }

      return payload as Record<string, unknown>;
    } catch {
      throw new YoutubeProviderError(
        "YOUTUBE_RESPONSE_INVALID",
        "YouTube returned an invalid response",
      );
    }
  }

  private requirePlayback(commandId: string): YoutubePlayback {
    const playback = this.playbacks.get(commandId);

    if (!playback) {
      throw new Error("No YouTube playback exists for this command");
    }

    return playback;
  }

  private report(commandId: string): PlaybackReport {
    const playback = this.requirePlayback(commandId);
    return { commandId, positionMs: 0, state: playback.state };
  }
}

class YoutubeProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function readArray<Item>(
  payload: Record<string, unknown>,
  key: string,
): Item[] {
  return Array.isArray(payload[key]) ? (payload[key] as Item[]) : [];
}

function readBoundedString(
  payload: Record<string, unknown>,
  key: string,
  maxLength: number,
): string | null {
  const value = payload[key];
  return typeof value === "string" && value.length <= maxLength ? value : null;
}

function readThumbnail(
  thumbnails: Record<string, { url?: string }> | undefined,
): string | null {
  if (!thumbnails || typeof thumbnails !== "object") {
    return null;
  }

  for (const key of ["high", "medium", "default"]) {
    const url = thumbnails[key]?.url;

    if (typeof url === "string" && url.startsWith("https://")) {
      return url;
    }
  }

  return null;
}

export function parseYoutubeDuration(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const match =
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(
      value,
    );

  if (!match) {
    return null;
  }

  const [, days = "0", hours = "0", minutes = "0", seconds = "0"] = match;
  const totalSeconds =
    Number(days) * 86_400 +
    Number(hours) * 3_600 +
    Number(minutes) * 60 +
    Number(seconds);
  return Number.isFinite(totalSeconds)
    ? Math.round(totalSeconds * 1_000)
    : null;
}

function isYoutubeVideoId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{11}$/.test(value);
}

function decodeYoutubeText(value: string): string {
  const namedEntities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    quot: '"',
  };

  return value.replace(
    /&(#x[\da-f]+|#\d+|amp|apos|gt|lt|quot);/gi,
    (entity, body: string) => {
      if (body.startsWith("#x")) {
        return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
      }

      if (body.startsWith("#")) {
        return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
      }

      return namedEntities[body.toLowerCase()] ?? entity;
    },
  );
}
