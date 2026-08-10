import { errors, jwtVerify } from 'jose';
import { ZodError, z } from 'zod';

import { TOKEN_AUDIENCE, TOKEN_ISSUER } from '../../config/constants.js';
import { InvalidRefreshTokenError } from '../../modules/auth/auth.errors.js';
import type { RefreshTokenVerifier, VerifiedRefreshToken } from '../../modules/auth/auth.types.js';

const refreshClaimsSchema = z.object({
  sub: z.uuid(),
  tokenType: z.literal('refresh'),
  jti: z.string().uuid(),
});

export interface JoseRefreshTokenVerifierOptions {
  refreshTokenSecret: string;
  clock?: () => Date;
}

export class JoseRefreshTokenVerifier implements RefreshTokenVerifier {
  readonly #secret: Uint8Array;
  readonly #clock: () => Date;

  constructor({ refreshTokenSecret, clock = () => new Date() }: JoseRefreshTokenVerifierOptions) {
    this.#secret = new TextEncoder().encode(refreshTokenSecret);
    this.#clock = clock;
  }

  async verify(token: string): Promise<VerifiedRefreshToken> {
    try {
      const { payload } = await jwtVerify(token, this.#secret, {
        algorithms: ['HS256'],
        issuer: TOKEN_ISSUER,
        audience: TOKEN_AUDIENCE,
        requiredClaims: ['iss', 'aud', 'sub', 'exp', 'iat', 'tokenType', 'jti'],
        currentDate: this.#clock(),
      });
      const claims = refreshClaimsSchema.parse(payload);

      return {
        userId: claims.sub,
        jti: claims.jti,
      };
    } catch (error) {
      if (error instanceof InvalidRefreshTokenError) {
        throw error;
      }

      if (error instanceof errors.JOSEError || error instanceof ZodError) {
        throw new InvalidRefreshTokenError();
      }

      throw error;
    }
  }
}
