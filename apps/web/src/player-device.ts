import { PlayerDeviceIdSchema } from "@easyplaylist/contracts";

const PLAYER_DEVICE_STORAGE_KEY = "easyplaylist.playerDeviceId";

type PlayerDeviceStorage = Pick<Storage, "getItem" | "setItem">;

export function getPlayerDeviceId(
  storage: PlayerDeviceStorage = window.sessionStorage,
  createId: () => string = () => crypto.randomUUID(),
): string {
  const existing = storage.getItem(PLAYER_DEVICE_STORAGE_KEY);

  if (PlayerDeviceIdSchema.safeParse(existing).success) {
    return existing!;
  }

  const created = PlayerDeviceIdSchema.parse(createId());
  storage.setItem(PLAYER_DEVICE_STORAGE_KEY, created);
  return created;
}
