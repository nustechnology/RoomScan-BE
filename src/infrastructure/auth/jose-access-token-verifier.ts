import { errors, jwtVerify } from 'jose';
import { ZodError, z } from 'zod';

import { TOKEN_AUDIENCE, TOKEN_ISSUER } from '../../config/constants.js';
import {
  InvalidAccessTokenError,
  type AccessTokenVerifier,
  type VerifiedAccessToken,
} from '../../common/middleware/authenticate.js';

const accessClaimsSchema = z.object({
  sub: z.uuid(),
  tokenType: z.literal('access'),
});

export interface JoseAccessTokenVerifierOptions {
  accessTokenSecret: string;
  clock?: () => Date;
}

export class JoseAccessTokenVerifier implements AccessTokenVerifier {
  readonly #secret: Uint8Array;
  readonly #clock: () => Date;

  constructor({ accessTokenSecret, clock = () => new Date() }: JoseAccessTokenVerifierOptions) {
    this.#secret = new TextEncoder().encode(accessTokenSecret);
    this.#clock = clock;
  }

  async verify(accessToken: string): Promise<VerifiedAccessToken> {
    try {
      const { payload } = await jwtVerify(accessToken, this.#secret, {
        algorithms: ['HS256'],
        issuer: TOKEN_ISSUER,
        audience: TOKEN_AUDIENCE,
        requiredClaims: ['iss', 'aud', 'sub', 'exp', 'iat', 'tokenType'],
        currentDate: this.#clock(),
      });
      const claims = accessClaimsSchema.parse(payload);

      return {
        userId: claims.sub,
      };
    } catch (error) {
      if (error instanceof InvalidAccessTokenError) {
        throw error;
      }

      if (error instanceof errors.JOSEError || error instanceof ZodError) {
        throw new InvalidAccessTokenError();
      }

      throw error;
    }
  }
}
