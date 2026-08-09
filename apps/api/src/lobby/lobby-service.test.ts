import { describe, expect, it, vi } from "vitest";

import {
  generateLobbyCode,
  LobbyService,
  LobbySettingsCreatorRequiredError,
} from "./lobby-service.js";

const lobbyRow = {
  blind_test_enabled: false,
  code: "BC3D4E",
  created_at: new Date("2026-08-08T12:00:00.000Z"),
  display_name: "Camille",
  expires_at: new Date("2026-08-09T12:00:00.000Z"),
  id: "019c28ce-66d7-4733-a38c-f7aefb572429",
  is_creator: true,
  joined_at: new Date("2026-08-08T12:00:00.000Z"),
  member_count: 1,
  name: "Anniversaire",
  status: "open",
  version: 0,
} as const;

describe("lobby code generation", () => {
  it("always emits six uppercase non-ambiguous characters", () => {
    for (let index = 0; index < 500; index += 1) {
      expect(generateLobbyCode()).toMatch(
        /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/,
      );
    }
  });

  it("retries a unique-code collision without leaking a partial lobby", async () => {
    const collision = Object.assign(new Error("duplicate"), {
      code: "23505",
      constraint: "lobbies_code_key",
    });
    const query = vi
      .fn()
      .mockRejectedValueOnce(collision)
      .mockResolvedValueOnce({
        rows: [
          {
            ...lobbyRow,
          },
        ],
      });
    const codes = ["AB2C3D", "BC3D4E"];
    const service = new LobbyService({
      clock: () => new Date("2026-08-08T12:00:00.000Z"),
      database: { query },
      generateCode: () => codes.shift() ?? "CD4E5F",
    });

    await expect(
      service.create({
        displayName: "Camille",
        name: "Anniversaire",
        participantId: "019c28cf-4167-464d-88c1-aefbedb2420d",
      }),
    ).resolves.toMatchObject({ code: "BC3D4E", memberCount: 1 });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenLastCalledWith(expect.any(String), [
      "Anniversaire",
      "BC3D4E",
      new Date("2026-08-08T12:00:00.000Z"),
      "019c28cf-4167-464d-88c1-aefbedb2420d",
      "Camille",
      24,
    ]);
  });

  it("accepts a configurable positive whole-hour lifetime", () => {
    expect(
      () =>
        new LobbyService({
          database: { query: vi.fn() },
          ttlHours: 0,
        }),
    ).toThrow("Lobby TTL must be a positive whole number of hours");
  });

  it("persists a creator-only blind-test setting and increments its version", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ ...lobbyRow, blind_test_enabled: true, version: 1 }],
    });
    const service = new LobbyService({ database: { query } });

    await expect(
      service.updateSettings(lobbyRow.id, "creator-id", {
        blindTestEnabled: true,
      }),
    ).resolves.toEqual({
      changed: true,
      lobby: expect.objectContaining({
        settings: { blindTestEnabled: true },
        version: 1,
      }),
    });
    expect(query).toHaveBeenCalledWith(expect.any(String), [
      lobbyRow.id,
      "creator-id",
      true,
      expect.any(Date),
    ]);
  });

  it("keeps an identical settings update as a no-op", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ ...lobbyRow, blind_test_enabled: true, version: 4 }],
      });
    const service = new LobbyService({ database: { query } });

    await expect(
      service.updateSettings(lobbyRow.id, "creator-id", {
        blindTestEnabled: true,
      }),
    ).resolves.toMatchObject({ changed: false, lobby: { version: 4 } });
  });

  it("refuses a settings update from a non-creator member", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ ...lobbyRow, display_name: "Noor", is_creator: false }],
      });
    const service = new LobbyService({ database: { query } });

    await expect(
      service.updateSettings(lobbyRow.id, "member-id", {
        blindTestEnabled: true,
      }),
    ).rejects.toBeInstanceOf(LobbySettingsCreatorRequiredError);
  });
});
