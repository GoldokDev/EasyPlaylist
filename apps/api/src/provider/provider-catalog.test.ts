import { describe, expect, it, vi } from "vitest";

import { FakeMusicProviderAdapter } from "./fake-music-provider.js";
import { ProviderCatalog } from "./provider-catalog.js";
import { YoutubeMusicProviderAdapter } from "./youtube-music-provider.js";

describe("provider catalog", () => {
  it("exposes YouTube configuration and fake limitations without secrets", async () => {
    const catalog = new ProviderCatalog({
      fakeAdapter: new FakeMusicProviderAdapter(),
    });

    const connections = await catalog.listForLobby(
      "019c28ce-66d7-4733-a38c-f7aefb572429",
    );

    expect(connections).toEqual([
      expect.objectContaining({
        capabilities: expect.arrayContaining(["web_playback"]),
        credentialStatus: "unavailable",
        displayName: "YouTube",
        isSimulation: false,
        provider: "youtube",
      }),
      expect.objectContaining({
        capabilities: expect.arrayContaining([
          "catalog_search",
          "web_playback",
          "token_refresh",
          "token_revoke",
        ]),
        credentialStatus: "active",
        displayName: "Mode démo",
        isSimulation: true,
        limitations: expect.arrayContaining([
          "Ce mode ne valide aucune capacité YouTube réelle.",
        ]),
        provider: "fake",
      }),
    ]);
    expect(JSON.stringify(connections)).not.toMatch(
      /accessToken|refreshToken|encryptedCredentials|ciphertext|authTag/,
    );
  });

  it("uses the real YouTube catalog when its server key is configured", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              id: { videoId: "dQw4w9WgXcQ" },
              snippet: { channelTitle: "Channel", title: "Real result" },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              contentDetails: { duration: "PT2M" },
              id: "dQw4w9WgXcQ",
              status: { embeddable: true },
            },
          ],
        }),
      );
    const catalog = new ProviderCatalog({
      fakeAdapter: new FakeMusicProviderAdapter(),
      youtubeAdapter: new YoutubeMusicProviderAdapter({
        apiKey: "test-key",
        fetchImpl,
      }),
    });

    const response = await catalog.searchForLobby(
      "019c28ce-66d7-4733-a38c-f7aefb572429",
      { limit: 10, q: "real result" },
    );

    expect(response.results).toHaveLength(1);
    expect(response.results[0]?.variants[0]).toMatchObject({
      connectionId: "youtube:019c28ce-66d7-4733-a38c-f7aefb572429",
      playbackAvailability: "playable",
      provider: "youtube",
      providerTrackId: "dQw4w9WgXcQ",
    });
    expect(response.results[0]?.title).toBe("Real result");
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200 });
}
