import { jwtVerify } from 'jose';
import { describe, expect, it } from 'vitest';

import { JoseAuthTokenIssuer } from '../src/infrastructure/auth/jwt-token-issuer.js';

const NOW = new Date('2026-07-23T07:00:00.000Z');
const ACCESS_SECRET = 'access-secret-that-is-at-least-32-characters';
const REFRESH_SECRET = 'refresh-secret-that-is-at-least-32-characters';

describe('JoseAuthTokenIssuer', () => {
  it('issues independently signed access and refresh tokens with the expected claims', async () => {
    const issuer = new JoseAuthTokenIssuer({
      accessTokenSecret: ACCESS_SECRET,
      refreshTokenSecret: REFRESH_SECRET,
      accessTokenTtlSeconds: 3600,
      refreshTokenTtlSeconds: 2_592_000,
      clock: () => NOW,
    });
    const userId = 'eb5d278f-c857-45c7-887d-7be65288cb75';
    const tokens = await issuer.issueTokens(userId);
    const access = await jwtVerify(tokens.accessToken, new TextEncoder().encode(ACCESS_SECRET), {
      algorithms: ['HS256'],
      issuer: 'roomscan-api',
      audience: 'roomscan-mobile',
      currentDate: NOW,
    });
    const refresh = await jwtVerify(tokens.refreshToken, new TextEncoder().encode(REFRESH_SECRET), {
      algorithms: ['HS256'],
      issuer: 'roomscan-api',
      audience: 'roomscan-mobile',
      currentDate: NOW,
    });

    expect(access.payload).toMatchObject({
      sub: userId,
      tokenType: 'access',
      iss: 'roomscan-api',
      aud: 'roomscan-mobile',
      iat: Math.floor(NOW.getTime() / 1000),
    });
    expect(refresh.payload).toMatchObject({
      sub: userId,
      tokenType: 'refresh',
      iss: 'roomscan-api',
      aud: 'roomscan-mobile',
      iat: Math.floor(NOW.getTime() / 1000),
    });
    expect(access.payload.exp! - access.payload.iat!).toBe(3600);
    expect(refresh.payload.exp! - refresh.payload.iat!).toBe(2_592_000);
    expect(access.payload.jti).toEqual(expect.any(String));
    expect(refresh.payload.jti).toEqual(expect.any(String));
    expect(access.payload.jti).not.toBe(refresh.payload.jti);
  });

  it('does not allow the refresh secret to verify an access token', async () => {
    const issuer = new JoseAuthTokenIssuer({
      accessTokenSecret: ACCESS_SECRET,
      refreshTokenSecret: REFRESH_SECRET,
      accessTokenTtlSeconds: 3600,
      refreshTokenTtlSeconds: 2_592_000,
      clock: () => NOW,
    });
    const { accessToken } = await issuer.issueTokens('eb5d278f-c857-45c7-887d-7be65288cb75');

    await expect(
      jwtVerify(accessToken, new TextEncoder().encode(REFRESH_SECRET), {
        algorithms: ['HS256'],
      }),
    ).rejects.toThrow();
  });
});
