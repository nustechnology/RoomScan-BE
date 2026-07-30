import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';

import { JoseAccessTokenVerifier } from '../src/infrastructure/auth/jose-access-token-verifier.js';
import { InvalidAccessTokenError } from '../src/common/middleware/authenticate.js';
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

describe('JoseAccessTokenVerifier', () => {
  it('verifies a valid access token and returns the user ID', async () => {
    const verifier = new JoseAccessTokenVerifier({
      accessTokenSecret: ACCESS_SECRET,
      clock: () => NOW,
    });
    const token = await signToken({ tokenType: 'access' }, ACCESS_SECRET);

    await expect(verifier.verify(token)).resolves.toEqual({ userId: USER_ID });
  });

  it('rejects an expired access token', async () => {
    const verifier = new JoseAccessTokenVerifier({
      accessTokenSecret: ACCESS_SECRET,
      clock: () => new Date('2026-07-29T12:00:00.000Z'),
    });
    const token = await signToken({ tokenType: 'access' }, ACCESS_SECRET, {
      expiresIn: 1,
    });

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(InvalidAccessTokenError);
  });

  it('rejects a token signed with a different secret', async () => {
    const verifier = new JoseAccessTokenVerifier({
      accessTokenSecret: ACCESS_SECRET,
      clock: () => NOW,
    });
    const token = await signToken({ tokenType: 'access' }, 'wrong-secret-that-is-at-least-32-char');

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(InvalidAccessTokenError);
  });

  it('rejects a token with a mismatched issuer', async () => {
    const verifier = new JoseAccessTokenVerifier({
      accessTokenSecret: ACCESS_SECRET,
      clock: () => NOW,
    });
    const token = await signToken({ tokenType: 'access' }, ACCESS_SECRET, {
      issuer: 'wrong-issuer',
    });

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(InvalidAccessTokenError);
  });

  it('rejects a token with a mismatched audience', async () => {
    const verifier = new JoseAccessTokenVerifier({
      accessTokenSecret: ACCESS_SECRET,
      clock: () => NOW,
    });
    const token = await signToken({ tokenType: 'access' }, ACCESS_SECRET, {
      audience: 'wrong-audience',
    });

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(InvalidAccessTokenError);
  });

  it('rejects a refresh token', async () => {
    const verifier = new JoseAccessTokenVerifier({
      accessTokenSecret: ACCESS_SECRET,
      clock: () => NOW,
    });
    const token = await signToken({ tokenType: 'refresh' }, ACCESS_SECRET);

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(InvalidAccessTokenError);
  });

  it('rejects a token with a non-UUID subject', async () => {
    const verifier = new JoseAccessTokenVerifier({
      accessTokenSecret: ACCESS_SECRET,
      clock: () => NOW,
    });
    const token = await signToken({ tokenType: 'access' }, ACCESS_SECRET, {
      subject: 'not-a-uuid',
    });

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(InvalidAccessTokenError);
  });

  it('rejects a token signed with the refresh secret', async () => {
    const verifier = new JoseAccessTokenVerifier({
      accessTokenSecret: ACCESS_SECRET,
      clock: () => NOW,
    });
    const token = await signToken({ tokenType: 'access' }, REFRESH_SECRET);

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(InvalidAccessTokenError);
  });

  it('rejects a malformed token string', async () => {
    const verifier = new JoseAccessTokenVerifier({
      accessTokenSecret: ACCESS_SECRET,
      clock: () => NOW,
    });

    await expect(verifier.verify('not-a-jwt')).rejects.toBeInstanceOf(InvalidAccessTokenError);
  });

  it('uses the system clock when no clock option is supplied', async () => {
    const verifier = new JoseAccessTokenVerifier({
      accessTokenSecret: ACCESS_SECRET,
    });
    const now = Math.floor(Date.now() / 1000);
    const encoder = new TextEncoder();
    const token = await new SignJWT({ tokenType: 'access' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(USER_ID)
      .setIssuer(TOKEN_ISSUER)
      .setAudience(TOKEN_AUDIENCE)
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(encoder.encode(ACCESS_SECRET));

    await expect(verifier.verify(token)).resolves.toEqual({ userId: USER_ID });
  });
});
