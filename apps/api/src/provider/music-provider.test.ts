import { describe, expect, it, vi } from "vitest";

import {
  CapabilityAwareMusicProvider,
  ProviderCapabilityUnavailableError,
  type MusicProviderAdapter,
  type ProviderConnectionRef,
} from "./music-provider.js";

function createAdapter(): MusicProviderAdapter {
  return {
    getCapabilities: vi.fn().mockResolvedValue(["catalog_search"]),
    getCredentialStatus: vi
      .fn()
      .mockResolvedValue({ expiresAt: null, status: "active" }),
    getPlaybackReport: vi.fn(),
    pause: vi.fn(),
    provider: "fake",
    refreshCredentials: vi.fn(),
    resolve: vi.fn(),
    resume: vi.fn(),
    revokeCredentials: vi.fn(),
    search: vi
      .fn()
      .mockResolvedValue({ issues: [], nextCursor: null, results: [] }),
    skip: vi.fn(),
    start: vi.fn(),
  };
}

describe("capability-aware provider boundary", () => {
  it("never calls an adapter operation whose capability is absent", async () => {
    const adapter = createAdapter();
    const connection: ProviderConnectionRef = {
      capabilities: ["catalog_search"],
      id: "fake:test",
      lobbyId: "test",
      provider: "fake",
    };
    const provider = new CapabilityAwareMusicProvider(adapter, connection);

    await expect(
      provider.search({ limit: 1, text: "Allowed" }),
    ).resolves.toMatchObject({ results: [] });
    expect(adapter.search).toHaveBeenCalledOnce();

    expect(() =>
      provider.start({
        commandId: "forbidden",
        variant: {
          durationMs: 1_000,
          playbackRef: "not-called",
          provider: "fake",
          providerTrackId: "fake:1",
        },
      }),
    ).toThrow(ProviderCapabilityUnavailableError);
    expect(adapter.start).not.toHaveBeenCalled();
    expect(() => provider.refreshCredentials()).toThrow(
      ProviderCapabilityUnavailableError,
    );
    expect(adapter.refreshCredentials).not.toHaveBeenCalled();
  });

  it("rejects a connection wired to the wrong adapter", () => {
    const adapter = createAdapter();
    const connection: ProviderConnectionRef = {
      capabilities: [],
      id: "spotify:test",
      lobbyId: "test",
      provider: "spotify",
    };

    expect(() => new CapabilityAwareMusicProvider(adapter, connection)).toThrow(
      "Provider adapter and connection do not match",
    );
  });
});
