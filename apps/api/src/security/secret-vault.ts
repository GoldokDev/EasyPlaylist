import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface EncryptedSecretEnvelope {
  authTag: string;
  ciphertext: string;
  iv: string;
  keyVersion: number;
}

export class SecretDecryptionError extends Error {
  constructor() {
    super("Encrypted secret cannot be authenticated");
    this.name = "SecretDecryptionError";
  }
}

export class SecretVault {
  constructor(
    private readonly keys: ReadonlyMap<number, Buffer>,
    private readonly activeKeyVersion: number,
  ) {
    if (!keys.has(activeKeyVersion)) {
      throw new Error("Active encryption key version is unavailable");
    }

    for (const [version, key] of keys) {
      if (!Number.isSafeInteger(version) || version < 1 || key.length !== 32) {
        throw new Error(
          "Encryption keys require a positive version and 32 bytes",
        );
      }
    }
  }

  encrypt(plaintext: string): EncryptedSecretEnvelope {
    const key = this.keys.get(this.activeKeyVersion);

    if (!key) {
      throw new Error("Active encryption key version is unavailable");
    }

    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(`key-version:${this.activeKeyVersion}`));
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);

    return {
      authTag: cipher.getAuthTag().toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
      iv: iv.toString("base64url"),
      keyVersion: this.activeKeyVersion,
    };
  }

  decrypt(untrustedEnvelope: unknown): string {
    try {
      const envelope = parseEnvelope(untrustedEnvelope);
      const key = this.keys.get(envelope.keyVersion);

      if (!key) {
        throw new Error("Unknown key version");
      }

      const iv = Buffer.from(envelope.iv, "base64url");
      const authTag = Buffer.from(envelope.authTag, "base64url");
      const ciphertext = Buffer.from(envelope.ciphertext, "base64url");

      if (iv.length !== 12 || authTag.length !== 16) {
        throw new Error("Malformed envelope");
      }

      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAAD(Buffer.from(`key-version:${envelope.keyVersion}`));
      decipher.setAuthTag(authTag);

      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new SecretDecryptionError();
    }
  }
}

function parseEnvelope(value: unknown): EncryptedSecretEnvelope {
  if (!value || typeof value !== "object") {
    throw new Error("Malformed envelope");
  }

  const envelope = value as Record<string, unknown>;

  if (
    typeof envelope.authTag !== "string" ||
    typeof envelope.ciphertext !== "string" ||
    typeof envelope.iv !== "string" ||
    !Number.isSafeInteger(envelope.keyVersion) ||
    (envelope.keyVersion as number) < 1
  ) {
    throw new Error("Malformed envelope");
  }

  return envelope as unknown as EncryptedSecretEnvelope;
}

export function createSecretVaultFromEnvironment(
  environment: NodeJS.ProcessEnv,
): SecretVault {
  const activeKeyVersion = Number.parseInt(
    environment.SECRETS_ACTIVE_KEY_VERSION ?? "1",
    10,
  );
  const keys = new Map<number, Buffer>();

  for (const [name, encodedKey] of Object.entries(environment)) {
    const match = /^SECRETS_ENCRYPTION_KEY_V([1-9]\d*)$/.exec(name);

    if (!match || !encodedKey) {
      continue;
    }

    const version = Number.parseInt(match[1] ?? "", 10);
    const key = Buffer.from(encodedKey, "base64");

    if (key.length !== 32) {
      throw new Error(
        `Encryption key version ${version} must decode to exactly 32 bytes`,
      );
    }

    keys.set(version, key);
  }

  if (!keys.has(activeKeyVersion)) {
    throw new Error(`Missing encryption key version ${activeKeyVersion}`);
  }

  return new SecretVault(keys, activeKeyVersion);
}
