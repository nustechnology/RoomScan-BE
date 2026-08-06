import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';

import { JoseRefreshTokenVerifier } from '../src/infrastructure/auth/jose-refresh-token-verifier.js';
import { InvalidRefreshTokenError } from '../src/modules/auth/auth.errors.js';
import { TOKEN_AUDIENCE, TOKEN_ISSUER } from '../src/config/constants.js';

const NOW = new Date('2026-07-29T10:00:00.000Z');
const ACCESS_SECRET = 'access-secret-that-is-at-least-32-characters';
const REFRESH_SECRET = 'refresh-secret-that-is-at-least-32-characters';
const USER_ID = 'eb5d278f-c857-45c7-887d-7be65288cb75';

function signToken(
  payload: Record<string, unknown>,
  secret: string,
  options: {
    subject?: string;
    issuer?: string;
    audience?: string;
    expiresIn?: number;
    issuedAt?: number;
  } = {},
): Promise<string> {
  const encoder = new TextEncoder();
  const issuedAt = options.issuedAt ?? Math.floor(NOW.getTime() / 1000);
  const expiresIn = options.expiresIn ?? 3600;

  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(options.subject ?? USER_ID)
    .setIssuer(options.issuer ?? TOKEN_ISSUER)
    .setAudience(options.audience ?? TOKEN_AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + expiresIn)
    .sign(encoder.encode(secret));
}

describe('JoseRefreshTokenVerifier', () => {
  it('verifies a valid refresh token and returns user ID and JTI', async () => {
    const verifier = new JoseRefreshTokenVerifier({
      refreshTokenSecret: REFRESH_SECRET,
      clock: () => NOW,
    });
    const token = await signToken(
      { tokenType: 'refresh', jti: 'eb5d278f-c857-45c7-887d-7be65288cb75' },
      REFRESH_SECRET,
    );

    await expect(verifier.verify(token)).resolves.toEqual({
      userId: USER_ID,
      jti: 'eb5d278f-c857-45c7-887d-7be65288cb75',
    });
  });

  it('rejects an expired refresh token', async () => {
    const verifier = new JoseRefreshTokenVerifier({
      refreshTokenSecret: REFRESH_SECRET,
      clock: () => new Date('2026-07-29T12:00:00.000Z'),
    });
    const token = await signToken(
      { tokenType: 'refresh', jti: 'eb5d278f-c857-45c7-887d-7be65288cb75' },
      REFRESH_SECRET,
      { expiresIn: 1 },
    );

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(InvalidRefreshTokenError);
  });

  it('rejects a token signed with a different secret', async () => {
    const verifier = new JoseRefreshTokenVerifier({
      refreshTokenSecret: REFRESH_SECRET,
      clock: () => NOW,
    });
    const token = await signToken(
      { tokenType: 'refresh', jti: 'eb5d278f-c857-45c7-887d-7be65288cb75' },
      'wrong-secret-that-is-at-least-32-char',
    );

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(InvalidRefreshTokenError);
  });

  it('rejects an access token (wrong token type)', async () => {
    const verifier = new JoseRefreshTokenVerifier({
      refreshTokenSecret: REFRESH_SECRET,
      clock: () => NOW,
    });
    const token = await signToken({ tokenType: 'access' }, REFRESH_SECRET);

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(InvalidRefreshTokenError);
  });

  it('rejects a token signed with the access secret', async () => {
    const verifier = new JoseRefreshTokenVerifier({
      refreshTokenSecret: REFRESH_SECRET,
      clock: () => NOW,
    });
    const token = await signToken(
      { tokenType: 'refresh', jti: 'eb5d278f-c857-45c7-887d-7be65288cb75' },
      ACCESS_SECRET,
    );

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(InvalidRefreshTokenError);
  });

  it('rejects a malformed token string', async () => {
    const verifier = new JoseRefreshTokenVerifier({
      refreshTokenSecret: REFRESH_SECRET,
      clock: () => NOW,
    });

    await expect(verifier.verify('not-a-jwt')).rejects.toBeInstanceOf(InvalidRefreshTokenError);
  });

  it('rejects a token signed with the refresh secret but wrong issuer', async () => {
    const verifier = new JoseRefreshTokenVerifier({
      refreshTokenSecret: REFRESH_SECRET,
      clock: () => NOW,
    });
    const token = await signToken(
      { tokenType: 'refresh', jti: 'eb5d278f-c857-45c7-887d-7be65288cb75' },
      REFRESH_SECRET,
      { issuer: 'wrong-issuer' },
    );

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(InvalidRefreshTokenError);
  });
});
