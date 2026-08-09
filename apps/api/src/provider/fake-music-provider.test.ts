import { describe, expect, it } from "vitest";

import { runMusicProviderAdapterContract } from "./music-provider-adapter.contract.js";
import {
  FakeMusicProviderAdapter,
  fakeProviderCapabilities,
} from "./fake-music-provider.js";
import {
  CapabilityAwareMusicProvider,
  ProviderCredentialsExpiredError,
  ProviderTrackUnavailableError,
  ProviderUnavailableError,
  type ProviderConnectionRef,
  type TrackCandidate,
} from "./music-provider.js";

const connection: ProviderConnectionRef = {
  capabilities: fakeProviderCapabilities,
  id: "fake:test-lobby",
  lobbyId: "test-lobby",
  provider: "fake",
};

runMusicProviderAdapterContract("fake", () => {
  let now = Date.parse("2026-08-08T12:00:00.000Z");
  return {
    adapter: new FakeMusicProviderAdapter({ clock: () => now }),
    advancePastTrackEnd: () => {
      now += 300_000;
    },
    connection,
  };
});

describe("fake music provider scenarios", () => {
  it("returns useful results alongside a deterministic partial failure", async () => {
    const adapter = new FakeMusicProviderAdapter({
      scenario: "partial_failure",
    });

    const page = await adapter.search({ limit: 3, text: "Party" }, connection);

    expect(page.results).toHaveLength(3);
    expect(page.issues).toEqual([
      {
        code: "FAKE_CATALOG_SHARD_UNAVAILABLE",
        message: "One simulated catalog shard did not answer",
        retryable: true,
      },
    ]);
  });

  it("blocks operations until simulated expired credentials are refreshed", async () => {
    const adapter = new FakeMusicProviderAdapter({ scenario: "expired" });
    const provider = new CapabilityAwareMusicProvider(adapter, connection);

    await expect(
      provider.search({ limit: 1, text: "Expired" }),
    ).rejects.toBeInstanceOf(ProviderCredentialsExpiredError);
    await expect(provider.getCredentialStatus()).resolves.toMatchObject({
      status: "expired",
    });
    await expect(provider.refreshCredentials()).resolves.toMatchObject({
      status: "active",
    });
    await expect(
      provider.search({ limit: 1, text: "Recovered" }),
    ).resolves.toMatchObject({ results: [expect.any(Object)] });
  });

  it("simulates complete provider unavailability", async () => {
    const adapter = new FakeMusicProviderAdapter({ scenario: "unavailable" });

    await expect(
      adapter.search({ limit: 1, text: "Offline" }, connection),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
    await expect(adapter.getCredentialStatus(connection)).resolves.toEqual({
      expiresAt: null,
      status: "unavailable",
    });
  });

  it("refuses a title that disappears before playback resolution", async () => {
    const adapter = new FakeMusicProviderAdapter();
    const unavailableTrack: TrackCandidate = {
      album: "Gone",
      artists: ["Nobody"],
      durationMs: 1_000,
      explicit: false,
      imageUrl: null,
      isrc: null,
      provider: "fake",
      providerTrackId: "fake:unavailable",
      title: "Unavailable",
    };

    await expect(
      adapter.resolve(unavailableTrack, connection),
    ).rejects.toBeInstanceOf(ProviderTrackUnavailableError);
  });
});
