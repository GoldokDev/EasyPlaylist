import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

interface IdentityQueryResult<Row> {
  rows: Row[];
}

export interface IdentityDatabase {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<IdentityQueryResult<Row>>;
}

export interface GuestIdentityResolution {
  created: boolean;
  expiresAt: Date;
  participantId: string;
  setCookie?: string;
}

interface GuestIdentityOptions {
  clock?: () => Date;
  cookieName?: string;
  cookieSecure: boolean;
  database: IdentityDatabase;
  generateId?: () => string;
  signingKey: Buffer;
  ttlMs?: number;
}

interface GuestIdentityClaims {
  expiresAt: number;
  participantId: string;
  version: 1;
}

const defaultTtlMs = 24 * 60 * 60 * 1_000;

export class GuestIdentityManager {
  private readonly clock: () => Date;
  private readonly cookieName: string;
  private readonly generateId: () => string;
  private readonly ttlMs: number;

  constructor(private readonly options: GuestIdentityOptions) {
    if (options.signingKey.length < 32) {
      throw new Error(
        "Guest cookie signing key must contain at least 32 bytes",
      );
    }

    this.clock = options.clock ?? (() => new Date());
    this.cookieName = options.cookieName ?? "easyplaylist_guest";
    this.generateId = options.generateId ?? randomUUID;
    this.ttlMs = options.ttlMs ?? defaultTtlMs;

    if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs < 1_000) {
      throw new Error("Guest identity TTL must be at least one second");
    }
  }

  async resolve(
    cookieHeader: string | undefined,
  ): Promise<GuestIdentityResolution> {
    const now = this.clock();
    const existingToken = readCookie(cookieHeader, this.cookieName);
    const existingClaims = existingToken
      ? this.verify(existingToken, now)
      : undefined;
    const claims =
      existingClaims ??
      ({
        expiresAt: now.getTime() + this.ttlMs,
        participantId: this.generateId(),
        version: 1,
      } satisfies GuestIdentityClaims);

    await this.options.database.query(
      `
        INSERT INTO participants (id, created_at, last_seen_at)
        VALUES ($1, $2, $2)
        ON CONFLICT (id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at
      `,
      [claims.participantId, now],
    );

    const resolution: GuestIdentityResolution = {
      created: !existingClaims,
      expiresAt: new Date(claims.expiresAt),
      participantId: claims.participantId,
    };

    if (!existingClaims) {
      resolution.setCookie = this.serializeCookie(
        this.sign(claims),
        resolution.expiresAt,
      );
    }

    return resolution;
  }

  private serializeCookie(value: string, expiresAt: Date): string {
    const attributes = [
      `${this.cookieName}=${value}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${Math.floor(this.ttlMs / 1_000)}`,
      `Expires=${expiresAt.toUTCString()}`,
    ];

    if (this.options.cookieSecure) {
      attributes.push("Secure");
    }

    return attributes.join("; ");
  }

  private sign(claims: GuestIdentityClaims): string {
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const signature = createHmac("sha256", this.options.signingKey)
      .update(payload)
      .digest("base64url");

    return `${payload}.${signature}`;
  }

  private verify(token: string, now: Date): GuestIdentityClaims | undefined {
    const [payload, signature, extra] = token.split(".");

    if (!payload || !signature || extra) {
      return undefined;
    }

    const expectedSignature = createHmac("sha256", this.options.signingKey)
      .update(payload)
      .digest();
    const actualSignature = Buffer.from(signature, "base64url");

    if (
      actualSignature.length !== expectedSignature.length ||
      !timingSafeEqual(actualSignature, expectedSignature)
    ) {
      return undefined;
    }

    try {
      const claims = JSON.parse(
        Buffer.from(payload, "base64url").toString("utf8"),
      ) as Partial<GuestIdentityClaims>;

      if (
        claims.version !== 1 ||
        typeof claims.participantId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          claims.participantId,
        ) ||
        !Number.isSafeInteger(claims.expiresAt) ||
        (claims.expiresAt as number) <= now.getTime()
      ) {
        return undefined;
      }

      return claims as GuestIdentityClaims;
    } catch {
      return undefined;
    }
  }
}

function readCookie(
  header: string | undefined,
  name: string,
): string | undefined {
  if (!header) {
    return undefined;
  }

  for (const entry of header.split(";")) {
    const separator = entry.indexOf("=");

    if (separator === -1) {
      continue;
    }

    if (entry.slice(0, separator).trim() === name) {
      return entry.slice(separator + 1).trim();
    }
  }

  return undefined;
}
