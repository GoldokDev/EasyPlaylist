import { describe, expect, it } from "vitest";

import type {
  MusicProviderAdapter,
  ProviderConnectionRef,
} from "./music-provider.js";

export interface MusicProviderContractHarness {
  adapter: MusicProviderAdapter;
  advancePastTrackEnd(): void;
  connection: ProviderConnectionRef;
}

export function runMusicProviderAdapterContract(
  name: string,
  createHarness: () => MusicProviderContractHarness,
): void {
  describe(`${name} music provider contract`, () => {
    it("reports unique effective capabilities for the matching provider", async () => {
      const { adapter, connection } = createHarness();
      const capabilities = await adapter.getCapabilities(connection);

      expect(adapter.provider).toBe(connection.provider);
      expect(new Set(capabilities).size).toBe(capabilities.length);
      expect(capabilities).toEqual(connection.capabilities);
    });

    it("returns normalized deterministic search results and resolves one", async () => {
      const { adapter, connection } = createHarness();
      const first = await adapter.search(
        { limit: 2, text: "Shared Signal" },
        connection,
      );
      const second = await adapter.search(
        { limit: 2, text: "Shared Signal" },
        connection,
      );

      expect(second).toEqual(first);
      expect(first.results).toHaveLength(2);
      expect(first.results[0]).toMatchObject({
        artists: expect.any(Array),
        durationMs: expect.any(Number),
        provider: connection.provider,
        providerTrackId: expect.any(String),
        title: expect.any(String),
      });

      const variant = await adapter.resolve(first.results[0]!, connection);
      expect(variant).toMatchObject({
        provider: connection.provider,
        providerTrackId: first.results[0]!.providerTrackId,
      });
    });

    it("starts playback and reports the end of the title", async () => {
      const harness = createHarness();
      const page = await harness.adapter.search(
        { limit: 1, text: "Final Track" },
        harness.connection,
      );
      const variant = await harness.adapter.resolve(
        page.results[0]!,
        harness.connection,
      );
      const command = { commandId: "contract-playback", variant };

      await expect(
        harness.adapter.start(command, harness.connection),
      ).resolves.toMatchObject({ positionMs: 0, state: "playing" });
      harness.advancePastTrackEnd();
      await expect(
        harness.adapter.getPlaybackReport(
          command.commandId,
          harness.connection,
        ),
      ).resolves.toMatchObject({
        positionMs: variant.durationMs,
        state: "ended",
      });
    });

    it("supports the declared credential refresh and revocation lifecycle", async () => {
      const { adapter, connection } = createHarness();

      await expect(
        adapter.getCredentialStatus(connection),
      ).resolves.toMatchObject({ status: "active" });
      await expect(
        adapter.refreshCredentials(connection),
      ).resolves.toMatchObject({ status: "active" });
      await adapter.revokeCredentials(connection);
      await expect(
        adapter.getCredentialStatus(connection),
      ).resolves.toMatchObject({ expiresAt: null, status: "revoked" });
    });
  });
}
