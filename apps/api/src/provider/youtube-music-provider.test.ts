import { describe, expect, it, vi } from "vitest";

import type { ProviderConnectionRef } from "./music-provider.js";
import {
  YoutubeMusicProviderAdapter,
  parseYoutubeDuration,
  youtubeProviderCapabilities,
} from "./youtube-music-provider.js";

const connection: ProviderConnectionRef = {
  capabilities: youtubeProviderCapabilities,
  id: "youtube:lobby-a",
  lobbyId: "lobby-a",
  provider: "youtube",
};

describe("YouTube music provider", () => {
  it("reports missing server configuration without attempting a request", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const adapter = new YoutubeMusicProviderAdapter({ fetchImpl });

    expect(adapter.isConfigured()).toBe(false);
    await expect(adapter.getCredentialStatus(connection)).resolves.toEqual({
      expiresAt: null,
      status: "unavailable",
    });
    await expect(
      adapter.search({ limit: 10, text: "music" }, connection),
    ).rejects.toMatchObject({ code: "YOUTUBE_NOT_CONFIGURED" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps embeddable music videos without exposing the API key", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              id: { videoId: "dQw4w9WgXcQ" },
              snippet: {
                channelTitle: "Rick Astley",
                thumbnails: {
                  high: { url: "https://i.ytimg.com/example.jpg" },
                },
                title: "Never Gonna Give You Up &amp; More",
              },
            },
          ],
          nextPageToken: "NEXT_PAGE",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              contentDetails: { duration: "PT3M33S" },
              id: "dQw4w9WgXcQ",
              status: { embeddable: true },
            },
          ],
        }),
      );
    const adapter = new YoutubeMusicProviderAdapter({
      apiKey: "test-key-never-log",
      fetchImpl,
      regionCode: "fr",
    });

    const page = await adapter.search(
      { cursor: "PAGE_ONE", limit: 10, text: "rick astley" },
      connection,
    );

    expect(page).toEqual({
      issues: [],
      nextCursor: "NEXT_PAGE",
      results: [
        {
          album: "Rick Astley",
          artists: ["Rick Astley"],
          durationMs: 213_000,
          explicit: false,
          imageUrl: "https://i.ytimg.com/example.jpg",
          isrc: null,
          provider: "youtube",
          providerTrackId: "dQw4w9WgXcQ",
          title: "Never Gonna Give You Up & More",
        },
      ],
    });
    const searchUrl = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(searchUrl.searchParams.get("type")).toBe("video");
    expect(searchUrl.searchParams.get("videoCategoryId")).toBe("10");
    expect(searchUrl.searchParams.get("videoEmbeddable")).toBe("true");
    expect(searchUrl.searchParams.get("videoSyndicated")).toBe("true");
    expect(searchUrl.searchParams.get("regionCode")).toBe("FR");
    expect(JSON.stringify(page)).not.toContain("test-key-never-log");
  });

  it("drops videos that YouTube reports as non-embeddable", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              id: { videoId: "dQw4w9WgXcQ" },
              snippet: { channelTitle: "Channel", title: "Title" },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              contentDetails: { duration: "PT1M" },
              id: "dQw4w9WgXcQ",
              status: { embeddable: false },
            },
          ],
        }),
      );
    const adapter = new YoutubeMusicProviderAdapter({
      apiKey: "test-key",
      fetchImpl,
    });

    await expect(
      adapter.search({ limit: 10, text: "blocked" }, connection),
    ).resolves.toMatchObject({ results: [] });
  });

  it("turns quota and access refusals into a bounded provider code", async () => {
    const adapter = new YoutubeMusicProviderAdapter({
      apiKey: "test-key",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        new Response("quota", {
          status: 403,
        }),
      ),
    });

    await expect(
      adapter.search({ limit: 10, text: "quota" }, connection),
    ).rejects.toMatchObject({ code: "YOUTUBE_QUOTA_OR_ACCESS_DENIED" });
  });

  it("synchronizes browser playback commands without server-side streaming", async () => {
    const adapter = new YoutubeMusicProviderAdapter({ apiKey: "test-key" });
    const variant = await adapter.resolve(
      {
        album: "Channel",
        artists: ["Channel"],
        durationMs: 60_000,
        explicit: false,
        imageUrl: null,
        isrc: null,
        provider: "youtube",
        providerTrackId: "dQw4w9WgXcQ",
        title: "Title",
      },
      connection,
    );
    const command = { commandId: "command-a", variant };

    await expect(adapter.start(command, connection)).resolves.toMatchObject({
      positionMs: 0,
      state: "playing",
    });
    await expect(adapter.pause(command, connection)).resolves.toMatchObject({
      state: "paused",
    });
    await expect(adapter.resume(command, connection)).resolves.toMatchObject({
      state: "playing",
    });
    await expect(adapter.skip(command, connection)).resolves.toMatchObject({
      state: "skipped",
    });
  });
});

describe("parseYoutubeDuration", () => {
  it.each([
    ["PT3M33S", 213_000],
    ["PT1H2M3S", 3_723_000],
    ["PT0.5S", 500],
    ["invalid", null],
    [undefined, null],
  ])("maps %s to %s milliseconds", (value, expected) => {
    expect(parseYoutubeDuration(value)).toBe(expected);
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}
