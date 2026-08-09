import { describe, expect, it } from "vitest";

import { getPlayerDeviceId } from "./player-device.js";

const firstDeviceId = "019c28da-0000-4000-8000-000000000001";
const secondDeviceId = "019c28da-0000-4000-8000-000000000002";

describe("player device identity", () => {
  it("survives reloads inside the same tab session", () => {
    const storage = memoryStorage();

    expect(getPlayerDeviceId(storage, () => firstDeviceId)).toBe(firstDeviceId);
    expect(getPlayerDeviceId(storage, () => secondDeviceId)).toBe(
      firstDeviceId,
    );
  });

  it("gives separate tabs independent player identities", () => {
    expect(getPlayerDeviceId(memoryStorage(), () => firstDeviceId)).toBe(
      firstDeviceId,
    );
    expect(getPlayerDeviceId(memoryStorage(), () => secondDeviceId)).toBe(
      secondDeviceId,
    );
  });

  it("replaces an invalid value instead of keeping a broken lease identity", () => {
    const storage = memoryStorage("not-a-device-id");

    expect(getPlayerDeviceId(storage, () => firstDeviceId)).toBe(firstDeviceId);
  });
});

function memoryStorage(initial?: string) {
  const values = new Map<string, string>();

  if (initial) {
    values.set("easyplaylist.playerDeviceId", initial);
  }

  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}
