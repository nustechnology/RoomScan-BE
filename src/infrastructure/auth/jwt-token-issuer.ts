import { randomUUID } from 'node:crypto';

import { SignJWT } from 'jose';

import { TOKEN_AUDIENCE, TOKEN_ISSUER } from '../../config/constants.js';
import type { AuthTokenIssuer, IssuedTokenPair } from '../../modules/auth/auth.types.js';

export interface JoseAuthTokenIssuerOptions {
  accessTokenSecret: string;
  refreshTokenSecret: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  clock?: () => Date;
}

export class JoseAuthTokenIssuer implements AuthTokenIssuer {
  readonly #accessTokenSecret: Uint8Array;
  readonly #refreshTokenSecret: Uint8Array;
  readonly #accessTokenTtlSeconds: number;
  readonly #refreshTokenTtlSeconds: number;
  readonly #clock: () => Date;

  constructor({
    accessTokenSecret,
    refreshTokenSecret,
    accessTokenTtlSeconds,
    refreshTokenTtlSeconds,
    clock = () => new Date(),
  }: JoseAuthTokenIssuerOptions) {
    const encoder = new TextEncoder();

    this.#accessTokenSecret = encoder.encode(accessTokenSecret);
    this.#refreshTokenSecret = encoder.encode(refreshTokenSecret);
    this.#accessTokenTtlSeconds = accessTokenTtlSeconds;
    this.#refreshTokenTtlSeconds = refreshTokenTtlSeconds;
    this.#clock = clock;
  }

  async issueTokens(userId: string): Promise<IssuedTokenPair> {
    const issuedAt = Math.floor(this.#clock().getTime() / 1000);
    const refreshTokenJti = randomUUID();
    const refreshTokenExpiresAt = new Date((issuedAt + this.#refreshTokenTtlSeconds) * 1000);
    const [accessToken, refreshToken] = await Promise.all([
      this.#signToken(
        userId,
        'access',
        this.#accessTokenSecret,
        issuedAt,
        this.#accessTokenTtlSeconds,
      ),
      this.#signToken(
        userId,
        'refresh',
        this.#refreshTokenSecret,
        issuedAt,
        this.#refreshTokenTtlSeconds,
        refreshTokenJti,
      ),
    ]);

    return {
      accessToken,
      refreshToken,
      refreshTokenJti,
      refreshTokenExpiresAt,
    };
  }

  async #signToken(
    userId: string,
    tokenType: 'access' | 'refresh',
    secret: Uint8Array,
    issuedAt: number,
    ttlSeconds: number,
    overrideJti?: string,
  ): Promise<string> {
    return new SignJWT({ tokenType })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(userId)
      .setIssuer(TOKEN_ISSUER)
      .setAudience(TOKEN_AUDIENCE)
      .setJti(overrideJti ?? randomUUID())
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + ttlSeconds)
      .sign(secret);
  }
}
