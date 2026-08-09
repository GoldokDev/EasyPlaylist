import { describe, expect, it, vi } from "vitest";

import { generateLobbyCode, LobbyService } from "./lobby-service.js";

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
});
