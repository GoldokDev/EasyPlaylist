import { describe, expect, it } from "vitest";

import {
  SecretDecryptionError,
  SecretVault,
  createSecretVaultFromEnvironment,
} from "./secret-vault.js";

describe("secret vault", () => {
  it("authenticates ciphertext and records its key version", () => {
    const vault = new SecretVault(new Map([[3, Buffer.alloc(32, 3)]]), 3);
    const envelope = vault.encrypt("refresh-token-value");

    expect(envelope.keyVersion).toBe(3);
    expect(JSON.stringify(envelope)).not.toContain("refresh-token-value");
    expect(vault.decrypt(envelope)).toBe("refresh-token-value");
  });

  it("refuses altered ciphertext, tags and key versions", () => {
    const vault = new SecretVault(new Map([[1, Buffer.alloc(32, 1)]]), 1);
    const envelope = vault.encrypt("refresh-token-value");
    const alter = (value: string) =>
      `${value[0] === "A" ? "B" : "A"}${value.slice(1)}`;

    for (const altered of [
      { ...envelope, ciphertext: alter(envelope.ciphertext) },
      { ...envelope, authTag: alter(envelope.authTag) },
      { ...envelope, keyVersion: 2 },
    ]) {
      expect(() => vault.decrypt(altered)).toThrow(SecretDecryptionError);
    }
  });

  it("requires an external 32-byte key", () => {
    expect(() =>
      createSecretVaultFromEnvironment({
        SECRETS_ACTIVE_KEY_VERSION: "1",
        SECRETS_ENCRYPTION_KEY_V1: Buffer.alloc(31).toString("base64"),
      }),
    ).toThrow("exactly 32 bytes");
  });
});
