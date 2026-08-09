import { createHash } from "node:crypto";

import {
  CatalogSearchResponseSchema,
  type CatalogSearchResponse,
  type ProviderCapability,
} from "@easyplaylist/contracts";

import {
  CapabilityAwareMusicProvider,
  type MusicProviderAdapter,
  type ProviderConnectionRef,
  type TrackCandidate,
} from "../provider/music-provider.js";

export interface CatalogSearchSource {
  adapter: MusicProviderAdapter;
  connection: ProviderConnectionRef;
  consentedForLobby: boolean;
}

interface CatalogSearchServiceOptions {
  sourceTimeoutMs?: number;
}

interface SearchInput {
  cursor?: string;
  limit: number;
  text: string;
}

interface SearchOutcome {
  connection: ProviderConnectionRef;
  page?: Awaited<ReturnType<MusicProviderAdapter["search"]>>;
  thrown?: unknown;
  timedOut?: boolean;
}

export class CatalogSearchService {
  private readonly sourceTimeoutMs: number;

  constructor(options: CatalogSearchServiceOptions = {}) {
    this.sourceTimeoutMs = options.sourceTimeoutMs ?? 2_000;
  }

  async search(
    sources: readonly CatalogSearchSource[],
    input: SearchInput,
  ): Promise<CatalogSearchResponse> {
    const eligible = sources.filter(
      ({ connection, consentedForLobby }) =>
        consentedForLobby && connection.capabilities.includes("catalog_search"),
    );
    const outcomes = await Promise.all(
      eligible.map((source) => this.searchSource(source, input)),
    );

    return CatalogSearchResponseSchema.parse(aggregateOutcomes(outcomes));
  }

  private async searchSource(
    source: CatalogSearchSource,
    input: SearchInput,
  ): Promise<SearchOutcome> {
    const provider = new CapabilityAwareMusicProvider(
      source.adapter,
      source.connection,
    );

    try {
      const page = await withTimeout(
        provider.search({
          ...(input.cursor ? { cursor: input.cursor } : {}),
          limit: input.limit,
          text: input.text,
        }),
        this.sourceTimeoutMs,
      );
      return { connection: source.connection, page };
    } catch (error) {
      return {
        connection: source.connection,
        thrown: error,
        timedOut: error instanceof SourceTimeoutError,
      };
    }
  }
}

class SourceTimeoutError extends Error {}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => reject(new SourceTimeoutError("Provider search timed out")),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function aggregateOutcomes(outcomes: readonly SearchOutcome[]) {
  const resultMap = new Map<
    string,
    {
      album: string;
      artists: string[];
      durationMs: number;
      explicit: boolean;
      id: string;
      imageUrl: string | null;
      isrc: string | null;
      title: string;
      variants: Array<{
        connectionId: string;
        playbackAvailability: "playable" | "unavailable" | "unknown";
        provider: string;
        providerTrackId: string;
      }>;
    }
  >();
  const issues: Array<{
    code: string;
    connectionId: string;
    message: string;
    provider: string;
    retryable: boolean;
    type: "provider" | "failure" | "timeout";
  }> = [];
  const cursors: Array<{
    connectionId: string;
    cursor: string;
    provider: string;
  }> = [];

  for (const outcome of outcomes) {
    const { connection } = outcome;

    if (!outcome.page) {
      issues.push({
        code: outcome.timedOut
          ? "PROVIDER_SEARCH_TIMEOUT"
          : readErrorCode(outcome.thrown),
        connectionId: connection.id,
        message: outcome.timedOut
          ? "The music source did not answer in time"
          : "The music source could not answer",
        provider: connection.provider,
        retryable: true,
        type: outcome.timedOut ? "timeout" : "failure",
      });
      continue;
    }

    if (outcome.page.nextCursor) {
      cursors.push({
        connectionId: connection.id,
        cursor: outcome.page.nextCursor,
        provider: connection.provider,
      });
    }

    for (const issue of outcome.page.issues) {
      issues.push({
        code: boundedCode(issue.code, "PROVIDER_PARTIAL_FAILURE"),
        connectionId: connection.id,
        message: "The music source returned partial results",
        provider: connection.provider,
        retryable: issue.retryable,
        type: "provider",
      });
    }

    for (const candidate of outcome.page.results) {
      addCandidate(resultMap, candidate, connection);
    }
  }

  return { cursors, issues, results: [...resultMap.values()] };
}

function addCandidate(
  resultMap: Map<string, ReturnType<typeof createResult>>,
  candidate: TrackCandidate,
  connection: ProviderConnectionRef,
): void {
  const key = deduplicationKey(candidate);
  const existing = resultMap.get(key) ?? createResult(key, candidate);
  const variantKey = `${connection.id}\u0000${candidate.providerTrackId}`;

  if (
    !existing.variants.some(
      (variant) =>
        `${variant.connectionId}\u0000${variant.providerTrackId}` ===
        variantKey,
    )
  ) {
    existing.variants.push({
      connectionId: connection.id,
      playbackAvailability: playbackAvailability(connection.capabilities),
      provider: candidate.provider,
      providerTrackId: candidate.providerTrackId,
    });
  }

  resultMap.set(key, existing);
}

function createResult(key: string, candidate: TrackCandidate) {
  return {
    album: candidate.album,
    artists: [...candidate.artists],
    durationMs: candidate.durationMs,
    explicit: candidate.explicit,
    id: createHash("sha256").update(key).digest("hex").slice(0, 24),
    imageUrl: candidate.imageUrl,
    isrc: candidate.isrc,
    title: candidate.title,
    variants: [] as Array<{
      connectionId: string;
      playbackAvailability: "playable" | "unavailable" | "unknown";
      provider: string;
      providerTrackId: string;
    }>,
  };
}

function deduplicationKey(candidate: TrackCandidate): string {
  if (candidate.isrc) {
    return `isrc:${candidate.isrc.trim().toUpperCase()}`;
  }

  return [
    "metadata",
    normalize(candidate.title),
    candidate.artists.map(normalize).sort().join("|"),
    Math.round(candidate.durationMs / 2_000),
  ].join(":");
}

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function playbackAvailability(
  capabilities: readonly ProviderCapability[],
): "playable" | "unavailable" | "unknown" {
  if (
    capabilities.includes("web_playback") ||
    capabilities.includes("remote_playback_control")
  ) {
    return "playable";
  }

  return capabilities.includes("track_metadata") ? "unavailable" : "unknown";
}

function readErrorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return boundedCode(error.code, "PROVIDER_SEARCH_FAILED");
  }

  return "PROVIDER_SEARCH_FAILED";
}

function boundedCode(value: string, fallback: string): string {
  const bounded = value.trim().slice(0, 100);
  return bounded || fallback;
}
