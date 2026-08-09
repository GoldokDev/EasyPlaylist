import { describe, expect, it, vi } from "vitest";

import type {
  MusicProviderAdapter,
  ProviderConnectionRef,
  SearchPage,
  TrackCandidate,
} from "../provider/music-provider.js";
import {
  CatalogSearchService,
  type CatalogSearchSource,
} from "./catalog-search-service.js";

const baseTrack: TrackCandidate = {
  album: "Shared Signals",
  artists: ["Static Friends"],
  durationMs: 205_000,
  explicit: false,
  imageUrl: null,
  isrc: "TEST00000001",
  provider: "fake-a",
  providerTrackId: "track-a",
  title: "Same Room",
};

describe("catalog search aggregation", () => {
  it("returns an empty response when no consented capable connection exists", async () => {
    const incapable = createSource("fake-a", [], vi.fn());
    const unconsented = {
      ...createSource("fake-b", ["catalog_search"], vi.fn()),
      consentedForLobby: false,
    };
    const service = new CatalogSearchService();

    await expect(
      service.search([incapable, unconsented], { limit: 10, text: "room" }),
    ).resolves.toEqual({ cursors: [], issues: [], results: [] });
    expect(incapable.adapter.search).not.toHaveBeenCalled();
    expect(unconsented.adapter.search).not.toHaveBeenCalled();
  });

  it("starts every eligible source concurrently and keeps cursor bounds", async () => {
    const first = deferred<SearchPage>();
    const second = deferred<SearchPage>();
    const firstSearch = vi.fn().mockReturnValue(first.promise);
    const secondSearch = vi.fn().mockReturnValue(second.promise);
    const sources = [
      createSource("fake-a", ["catalog_search"], firstSearch),
      createSource("fake-b", ["catalog_search"], secondSearch),
    ];
    const service = new CatalogSearchService({ sourceTimeoutMs: 1_000 });

    const pending = service.search(sources, {
      cursor: "bounded-cursor",
      limit: 7,
      text: "room",
    });
    expect(firstSearch).toHaveBeenCalledOnce();
    expect(secondSearch).toHaveBeenCalledOnce();
    expect(firstSearch).toHaveBeenCalledWith(
      { cursor: "bounded-cursor", limit: 7, text: "room" },
      expect.anything(),
    );

    first.resolve({ issues: [], nextCursor: "next-a", results: [] });
    second.resolve({ issues: [], nextCursor: null, results: [] });

    await expect(pending).resolves.toMatchObject({
      cursors: [
        {
          connectionId: "fake-a:connection",
          cursor: "next-a",
          provider: "fake-a",
        },
      ],
    });
  });

  it("deduplicates by ISRC, preserves variants and never merges on title alone", async () => {
    const sharedVariant = {
      ...baseTrack,
      provider: "fake-b",
      providerTrackId: "track-b",
    };
    const sameTitleDifferentRecording = {
      ...baseTrack,
      artists: ["Another Artist"],
      isrc: null,
      providerTrackId: "track-c",
    };
    const sources = [
      createSource(
        "fake-a",
        ["catalog_search", "track_metadata", "web_playback"],
        vi
          .fn()
          .mockResolvedValue(page([baseTrack, sameTitleDifferentRecording])),
      ),
      createSource(
        "fake-b",
        ["catalog_search", "track_metadata"],
        vi.fn().mockResolvedValue(page([sharedVariant])),
      ),
    ];

    const response = await new CatalogSearchService().search(sources, {
      limit: 10,
      text: "room",
    });

    expect(response.results).toHaveLength(2);
    expect(response.results[0]?.variants).toEqual([
      {
        connectionId: "fake-a:connection",
        playbackAvailability: "playable",
        provider: "fake-a",
        providerTrackId: "track-a",
      },
      {
        connectionId: "fake-b:connection",
        playbackAvailability: "unavailable",
        provider: "fake-b",
        providerTrackId: "track-b",
      },
    ]);
    expect(response.results[1]).toMatchObject({ artists: ["Another Artist"] });
  });

  it("returns provider issues and thrown failures without dropping successes", async () => {
    const partial = createSource(
      "fake-a",
      ["catalog_search", "web_playback"],
      vi.fn().mockResolvedValue({
        issues: [
          {
            code: "SHARD_UNAVAILABLE",
            message: "access-token-secret must not cross the boundary",
            retryable: true,
          },
        ],
        nextCursor: null,
        results: [baseTrack],
      }),
    );
    const failed = createSource(
      "fake-b",
      ["catalog_search"],
      vi.fn().mockRejectedValue(
        Object.assign(new Error("credential detail"), {
          code: "PROVIDER_CREDENTIALS_EXPIRED",
        }),
      ),
    );

    const response = await new CatalogSearchService().search(
      [partial, failed],
      { limit: 10, text: "room" },
    );

    expect(response.results).toHaveLength(1);
    expect(response.issues).toEqual([
      expect.objectContaining({ code: "SHARD_UNAVAILABLE", type: "provider" }),
      expect.objectContaining({
        code: "PROVIDER_CREDENTIALS_EXPIRED",
        message: "The music source could not answer",
        type: "failure",
      }),
    ]);
    expect(JSON.stringify(response)).not.toMatch(
      /credential detail|access-token-secret/,
    );
  });

  it("bounds a stalled source with an independent timeout", async () => {
    const stalled = createSource(
      "fake-a",
      ["catalog_search"],
      vi.fn().mockReturnValue(new Promise(() => {})),
    );

    const response = await new CatalogSearchService({
      sourceTimeoutMs: 5,
    }).search([stalled], { limit: 10, text: "room" });

    expect(response).toEqual({
      cursors: [],
      issues: [
        {
          code: "PROVIDER_SEARCH_TIMEOUT",
          connectionId: "fake-a:connection",
          message: "The music source did not answer in time",
          provider: "fake-a",
          retryable: true,
          type: "timeout",
        },
      ],
      results: [],
    });
  });
});

function createSource(
  provider: string,
  capabilities: ProviderConnectionRef["capabilities"],
  search: MusicProviderAdapter["search"],
): CatalogSearchSource {
  const connection: ProviderConnectionRef = {
    capabilities,
    id: `${provider}:connection`,
    lobbyId: "019c28ce-66d7-4733-a38c-f7aefb572429",
    provider,
  };
  const adapter = {
    getCapabilities: vi.fn().mockResolvedValue(capabilities),
    getCredentialStatus: vi
      .fn()
      .mockResolvedValue({ expiresAt: null, status: "active" }),
    getPlaybackReport: vi.fn(),
    pause: vi.fn(),
    provider,
    refreshCredentials: vi.fn(),
    resolve: vi.fn(),
    resume: vi.fn(),
    revokeCredentials: vi.fn(),
    search,
    skip: vi.fn(),
    start: vi.fn(),
  } satisfies MusicProviderAdapter;

  return { adapter, connection, consentedForLobby: true };
}

function page(results: readonly TrackCandidate[]): SearchPage {
  return { issues: [], nextCursor: null, results };
}

function deferred<T>() {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });

  return { promise, resolve: resolvePromise };
}
