import {
  type CatalogSearchQuery,
  type CatalogSearchResponse,
  ProviderConnectionSummarySchema,
  type ProviderConnectionSummary,
} from "@easyplaylist/contracts";

import { CatalogSearchService } from "../search/catalog-search-service.js";
import {
  FakeMusicProviderAdapter,
  fakeProviderCapabilities,
} from "./fake-music-provider.js";
import type {
  CapabilityAwareMusicProvider,
  MusicProviderAdapter,
  ProviderConnectionRef,
  TrackCandidate,
} from "./music-provider.js";
import { CapabilityAwareMusicProvider as GuardedProvider } from "./music-provider.js";
import {
  YoutubeMusicProviderAdapter,
  youtubePlaybackCapabilities,
  youtubeProviderCapabilities,
} from "./youtube-music-provider.js";

interface ProviderCatalogOptions {
  fakeAdapter?: MusicProviderAdapter;
  searchService?: CatalogSearchService;
  youtubeAdapter?: YoutubeMusicProviderAdapter;
  youtubeApiKey?: string;
  youtubeRegionCode?: string;
}

export class ProviderCatalog {
  private readonly providedFakeAdapter: MusicProviderAdapter | undefined;
  private readonly fakeAdapters = new Map<string, MusicProviderAdapter>();
  private readonly searchService: CatalogSearchService;
  private readonly youtubeAdapter: YoutubeMusicProviderAdapter;

  constructor(options: ProviderCatalogOptions = {}) {
    this.providedFakeAdapter = options.fakeAdapter;
    this.searchService = options.searchService ?? new CatalogSearchService();
    this.youtubeAdapter =
      options.youtubeAdapter ??
      new YoutubeMusicProviderAdapter({
        ...(options.youtubeApiKey ? { apiKey: options.youtubeApiKey } : {}),
        ...(options.youtubeRegionCode
          ? { regionCode: options.youtubeRegionCode }
          : {}),
      });
  }

  async listForLobby(lobbyId: string): Promise<ProviderConnectionSummary[]> {
    const fakeConnection = this.fakeConnection(lobbyId);
    const youtubeConnection = this.youtubeConnection(lobbyId);
    const fakeAdapter = this.fakeAdapter(lobbyId);
    const [fakeCapabilities, fakeCredentials, youtubeCredentials] =
      await Promise.all([
        fakeAdapter.getCapabilities(fakeConnection),
        fakeAdapter.getCredentialStatus(fakeConnection),
        this.youtubeAdapter.getCredentialStatus(youtubeConnection),
      ]);

    return [
      ProviderConnectionSummarySchema.parse({
        capabilities: youtubeConnection.capabilities,
        credentialStatus: youtubeCredentials.status,
        displayName: "YouTube",
        id: youtubeConnection.id,
        isSimulation: false,
        limitations: this.youtubeAdapter.isConfigured()
          ? [
              "La vidéo et les contrôles YouTube restent visibles sur l’appareil lecteur.",
              "La disponibilité dépend de l’intégration, du territoire, de l’âge et du quota Google.",
              "YouTube Music n’est pas intégré : la source recherche des vidéos YouTube publiques.",
            ]
          : [
              "Recherche inactive : configurez YOUTUBE_API_KEY côté serveur.",
              "Le lecteur IFrame ne nécessite aucun compte Premium, mais il reste visible.",
            ],
        provider: youtubeConnection.provider,
      }),
      ProviderConnectionSummarySchema.parse({
        capabilities: fakeCapabilities,
        credentialStatus: fakeCredentials.status,
        displayName: "Mode démo",
        id: fakeConnection.id,
        isSimulation: true,
        limitations: [
          "Catalogue et lecture entièrement simulés.",
          "Ce mode ne valide aucune capacité YouTube réelle.",
          "L’état du fake est réinitialisé au redémarrage de l’API.",
        ],
        provider: fakeConnection.provider,
      }),
    ];
  }

  async searchForLobby(
    lobbyId: string,
    query: CatalogSearchQuery,
  ): Promise<CatalogSearchResponse> {
    const sources = this.youtubeAdapter.isConfigured()
      ? [
          {
            adapter: this.youtubeAdapter,
            connection: this.youtubeConnection(lobbyId),
            consentedForLobby: true,
          },
        ]
      : [
          {
            adapter: this.fakeAdapter(lobbyId),
            connection: this.fakeConnection(lobbyId),
            consentedForLobby: true,
          },
        ];

    return this.searchService.search(sources, {
      ...(query.cursor ? { cursor: query.cursor } : {}),
      limit: query.limit,
      text: query.q,
    });
  }

  async isTrackAuthorizedForLobby(
    lobbyId: string,
    track: CatalogSearchResponse["results"][number],
  ): Promise<boolean> {
    const authorizedConnections = [this.fakeConnection(lobbyId)];

    if (this.youtubeAdapter.isConfigured()) {
      authorizedConnections.push(this.youtubeConnection(lobbyId));
    }

    return track.variants.every((variant) => {
      const connection = authorizedConnections.find(
        (candidate) =>
          candidate.id === variant.connectionId &&
          candidate.provider === variant.provider,
      );

      return Boolean(
        connection &&
        variant.playbackAvailability === "playable" &&
        (variant.provider !== "youtube" ||
          /^[A-Za-z0-9_-]{11}$/.test(variant.providerTrackId)),
      );
    });
  }

  getPlaybackSourceForLobby(
    lobbyId: string,
    track: CatalogSearchResponse["results"][number],
  ): { candidate: TrackCandidate; provider: CapabilityAwareMusicProvider } {
    const variant = track.variants.find((candidate) => {
      if (candidate.playbackAvailability !== "playable") {
        return false;
      }

      return (
        (candidate.connectionId === `youtube:${lobbyId}` &&
          candidate.provider === "youtube") ||
        (candidate.connectionId === `fake:${lobbyId}` &&
          candidate.provider === "fake")
      );
    });

    if (!variant) {
      throw new Error("No playable provider variant is available");
    }

    return {
      candidate: {
        album: track.album,
        artists: track.artists,
        durationMs: track.durationMs,
        explicit: track.explicit,
        imageUrl: track.imageUrl,
        isrc: track.isrc,
        provider: variant.provider,
        providerTrackId: variant.providerTrackId,
        title: track.title,
      },
      provider:
        variant.provider === "youtube"
          ? new GuardedProvider(
              this.youtubeAdapter,
              this.youtubeConnection(lobbyId),
            )
          : new GuardedProvider(
              this.fakeAdapter(lobbyId),
              this.fakeConnection(lobbyId),
            ),
    };
  }

  async purgeLobby(lobbyId: string): Promise<void> {
    const adapter = this.fakeAdapters.get(lobbyId);

    if (!adapter) {
      return;
    }

    const connection = this.fakeConnection(lobbyId);

    try {
      const capabilities = await adapter.getCapabilities(connection);

      if (capabilities.includes("token_revoke")) {
        await adapter.revokeCredentials(connection);
      }
    } finally {
      this.fakeAdapters.delete(lobbyId);
    }
  }

  private fakeAdapter(lobbyId: string): MusicProviderAdapter {
    if (this.providedFakeAdapter) {
      return this.providedFakeAdapter;
    }

    const existing = this.fakeAdapters.get(lobbyId);

    if (existing) {
      return existing;
    }

    const created = new FakeMusicProviderAdapter();
    this.fakeAdapters.set(lobbyId, created);
    return created;
  }

  private fakeConnection(lobbyId: string): ProviderConnectionRef {
    return {
      capabilities: fakeProviderCapabilities,
      id: `fake:${lobbyId}`,
      lobbyId,
      provider: "fake",
    };
  }

  private youtubeConnection(lobbyId: string): ProviderConnectionRef {
    return {
      capabilities: this.youtubeAdapter.isConfigured()
        ? youtubeProviderCapabilities
        : youtubePlaybackCapabilities,
      id: `youtube:${lobbyId}`,
      lobbyId,
      provider: "youtube",
    };
  }
}
