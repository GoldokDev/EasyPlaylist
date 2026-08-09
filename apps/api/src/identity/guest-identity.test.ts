import { describe, expect, it, vi } from "vitest";

import {
  GuestIdentityManager,
  type IdentityDatabase,
} from "./guest-identity.js";

const firstId = "019c28ce-66d7-4733-a38c-f7aefb572429";
const secondId = "019c28cf-4167-464d-88c1-aefbedb2420d";

function createDatabase() {
  return {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  } as unknown as IdentityDatabase;
}

function cookieValue(setCookie: string): string {
  return setCookie.split(";", 1)[0] ?? "";
}

describe("guest identity manager", () => {
  it("keeps a signed opaque identity across requests", async () => {
    const database = createDatabase();
    const manager = new GuestIdentityManager({
      clock: () => new Date("2026-08-08T12:00:00.000Z"),
      cookieSecure: true,
      database,
      generateId: () => firstId,
      signingKey: Buffer.alloc(32, 7),
    });

    const first = await manager.resolve(undefined);
    const second = await manager.resolve(cookieValue(first.setCookie ?? ""));

    expect(first.participantId).toBe(firstId);
    expect(first.created).toBe(true);
    expect(first.setCookie).toMatch(
      /HttpOnly; SameSite=Lax; Max-Age=86400; Expires=.*; Secure$/,
    );
    expect(second).toMatchObject({
      created: false,
      participantId: firstId,
    });
    expect(second.setCookie).toBeUndefined();
    expect(database.query).toHaveBeenCalledTimes(2);
  });

  it("replaces tampered and expired cookies", async () => {
    let now = new Date("2026-08-08T12:00:00.000Z");
    let generatedId = firstId;
    const manager = new GuestIdentityManager({
      clock: () => now,
      cookieSecure: false,
      database: createDatabase(),
      generateId: () => generatedId,
      signingKey: Buffer.alloc(32, 8),
      ttlMs: 1_000,
    });
    const first = await manager.resolve(undefined);
    const signedCookie = cookieValue(first.setCookie ?? "");

    generatedId = secondId;
    const tampered = await manager.resolve(`${signedCookie}x`);
    expect(tampered).toMatchObject({ created: true, participantId: secondId });

    now = new Date("2026-08-08T12:00:01.001Z");
    const expired = await manager.resolve(signedCookie);
    expect(expired).toMatchObject({ created: true, participantId: secondId });
  });
});
