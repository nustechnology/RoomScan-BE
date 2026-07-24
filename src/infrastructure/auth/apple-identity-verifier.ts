import {
  createRemoteJWKSet,
  errors,
  jwtVerify,
  type JWTVerifyGetKey,
  type RemoteJWKSetOptions,
} from 'jose';
import { z, ZodError } from 'zod';

import {
  AppleIdentityProviderUnavailableError,
  InvalidAppleIdentityTokenError,
} from '../../modules/auth/auth.errors.js';
import type {
  AppleIdentityVerifier,
  VerifiedAppleIdentity,
} from '../../modules/auth/auth.types.js';

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_JWKS_URL = new URL('https://appleid.apple.com/auth/keys');
const CLOCK_TOLERANCE_SECONDS = 60;

const optionalEmailSchema = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.email().optional(),
);

const appleClaimsSchema = z.object({
  sub: z.string().trim().min(1),
  iat: z.number().int(),
  email: optionalEmailSchema,
  email_verified: z.union([z.boolean(), z.enum(['true', 'false'])]).optional(),
});

export interface AppleIdentityTokenVerifierOptions {
  keyResolver?: JWTVerifyGetKey;
  clock?: () => Date;
}

export function createAppleRemoteKeyResolver(options: RemoteJWKSetOptions = {}): JWTVerifyGetKey {
  const remoteJwks = createRemoteJWKSet(APPLE_JWKS_URL, {
    timeoutDuration: 5_000,
    cooldownDuration: 30_000,
    cacheMaxAge: 600_000,
    ...options,
  });

  return async (protectedHeader, token) => {
    try {
      return await remoteJwks(protectedHeader, token);
    } catch (error) {
      if (
        error instanceof errors.JWKSNoMatchingKey ||
        error instanceof errors.JWKSMultipleMatchingKeys
      ) {
        throw error;
      }

      throw new AppleIdentityProviderUnavailableError();
    }
  };
}

export class AppleIdentityTokenVerifier implements AppleIdentityVerifier {
  readonly #clientId: string;
  readonly #keyResolver: JWTVerifyGetKey;
  readonly #clock: () => Date;

  constructor(
    clientId: string,
    {
      keyResolver = createAppleRemoteKeyResolver(),
      clock = () => new Date(),
    }: AppleIdentityTokenVerifierOptions = {},
  ) {
    this.#clientId = clientId;
    this.#keyResolver = keyResolver;
    this.#clock = clock;
  }

  async verify(identityToken: string): Promise<VerifiedAppleIdentity> {
    try {
      const currentDate = this.#clock();
      const { payload } = await jwtVerify(identityToken, this.#keyResolver, {
        algorithms: ['RS256'],
        issuer: APPLE_ISSUER,
        audience: this.#clientId,
        requiredClaims: ['iss', 'aud', 'sub', 'exp', 'iat'],
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        currentDate,
      });
      const claims = appleClaimsSchema.parse(payload);
      const nowSeconds = Math.floor(currentDate.getTime() / 1000);

      if (claims.iat > nowSeconds + CLOCK_TOLERANCE_SECONDS) {
        throw new InvalidAppleIdentityTokenError();
      }

      const email = claims.email ?? null;
      const emailVerified =
        email !== null && (claims.email_verified === true || claims.email_verified === 'true');

      return {
        providerId: claims.sub,
        email,
        emailVerified,
      };
    } catch (error) {
      if (error instanceof AppleIdentityProviderUnavailableError) {
        throw error;
      }

      if (
        error instanceof InvalidAppleIdentityTokenError ||
        error instanceof errors.JOSEError ||
        error instanceof ZodError
      ) {
        throw new InvalidAppleIdentityTokenError();
      }

      throw error;
    }
  }
}
