import { SignJWT } from 'jose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RefreshTokenService } from '../src/modules/auth/auth.service.js';
import { InvalidRefreshTokenError } from '../src/modules/auth/auth.errors.js';
import type {
  AuthTokenIssuer,
  IssuedTokenPair,
  RefreshTokenRepository,
  RefreshTokenVerifier,
} from '../src/modules/auth/auth.types.js';
import { TOKEN_AUDIENCE, TOKEN_ISSUER } from '../src/config/constants.js';

const NOW = new Date('2026-07-29T10:00:00.000Z');
const REFRESH_SECRET = 'refresh-secret-that-is-at-least-32-characters';
const ACCESS_SECRET = 'access-secret-that-is-at-least-32-characters';
const USER_ID = 'eb5d278f-c857-45c7-887d-7be65288cb75';

function createTestToken(options: {
  jti: string;
  userId?: string;
  expired?: boolean;
}): Promise<string> {
  const issuedAt = Math.floor(NOW.getTime() / 1000);
  const expiresIn = options.expired === true ? -60 : 3600;
  const encoder = new TextEncoder();

  return new SignJWT({ tokenType: 'refresh', jti: options.jti })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(options.userId ?? USER_ID)
    .setIssuer(TOKEN_ISSUER)
    .setAudience(TOKEN_AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + expiresIn)
    .sign(encoder.encode(REFRESH_SECRET));
}

describe('RefreshTokenService', () => {
  let verifyMock = vi.fn<RefreshTokenVerifier['verify']>();
  let saveTokenMock = vi.fn<RefreshTokenRepository['saveToken']>();
  let consumeMock = vi.fn<RefreshTokenRepository['consume']>();
  let issueTokensMock = vi.fn<AuthTokenIssuer['issueTokens']>();
  let service: RefreshTokenService;

  beforeEach(() => {
    verifyMock = vi.fn();
    saveTokenMock = vi.fn();
    consumeMock = vi.fn().mockResolvedValue(true);
    issueTokensMock = vi.fn().mockImplementation((userId: string): Promise<IssuedTokenPair> => {
      const encoder = new TextEncoder();
      const issuedAt = Math.floor(NOW.getTime() / 1000);

      return Promise.all([
        new SignJWT({ tokenType: 'access' })
          .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
          .setSubject(userId)
          .setIssuer(TOKEN_ISSUER)
          .setAudience(TOKEN_AUDIENCE)
          .setIssuedAt(issuedAt)
          .setExpirationTime(issuedAt + 3600)
          .sign(encoder.encode(ACCESS_SECRET)),
        new SignJWT({ tokenType: 'refresh', jti: '00000000-0000-4000-8000-000000000002' })
          .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
          .setSubject(userId)
          .setIssuer(TOKEN_ISSUER)
          .setAudience(TOKEN_AUDIENCE)
          .setIssuedAt(issuedAt)
          .setExpirationTime(issuedAt + 2_592_000)
          .sign(encoder.encode(REFRESH_SECRET)),
      ]).then(([accessToken, refreshToken]) => ({
        accessToken,
        refreshToken,
        refreshTokenJti: '00000000-0000-4000-8000-000000000002',
        refreshTokenExpiresAt: new Date(NOW.getTime() + 2_592_000 * 1000),
      }));
    });

    const tokenVerifier: RefreshTokenVerifier = {
      verify: verifyMock.mockImplementation((token: string) => {
        const [, payloadEncoded] = token.split('.');
        const payload = JSON.parse(Buffer.from(payloadEncoded!, 'base64url').toString('utf8')) as {
          sub: string;
          jti: string;
        };
        return Promise.resolve({ userId: payload.sub, jti: payload.jti });
      }),
    };
    const tokenRepository: RefreshTokenRepository = {
      saveToken: saveTokenMock,
      consume: consumeMock,
    };
    const tokenIssuer: AuthTokenIssuer = {
      issueTokens: issueTokensMock,
    };

    service = new RefreshTokenService({
      tokenVerifier,
      tokenRepository,
      tokenIssuer,
    });
  });

  it('rotates a valid refresh token and returns a new pair', async () => {
    const oldToken = await createTestToken({ jti: 'eb5d278f-c857-45c7-887d-7be65288cb75' });

    const result = await service.refresh(oldToken);

    expect(verifyMock).toHaveBeenCalledWith(oldToken);
    expect(consumeMock).toHaveBeenCalledWith('eb5d278f-c857-45c7-887d-7be65288cb75');
    expect(issueTokensMock).toHaveBeenCalledWith(USER_ID);
    expect(saveTokenMock).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000002',
      USER_ID,
      expect.any(Date),
    );
    const savedExpiresAt = saveTokenMock.mock.calls[0]?.[2] as Date;
    expect(savedExpiresAt.getTime()).toBeGreaterThan(NOW.getTime());

    expect(result.accessToken).toEqual(expect.any(String));
    expect(result.refreshToken).toEqual(expect.any(String));
    expect(result.accessToken).not.toBe(oldToken);
    expect(result.refreshToken).not.toBe(oldToken);
  });

  it('rejects a token when consume returns false', async () => {
    consumeMock.mockResolvedValue(false);
    const token = await createTestToken({ jti: 'eb5d278f-c857-45c7-887d-7be65288cb75' });

    await expect(service.refresh(token)).rejects.toBeInstanceOf(InvalidRefreshTokenError);
    expect(issueTokensMock).not.toHaveBeenCalled();
  });

  it('rejects a reused JTI — concurrent calls only permit one success', async () => {
    const token = await createTestToken({ jti: 'eb5d278f-c857-45c7-887d-7be65288cb75' });
    let callCount = 0;
    consumeMock.mockImplementation(() => {
      callCount += 1;
      return Promise.resolve(callCount === 1);
    });

    const results = await Promise.allSettled([service.refresh(token), service.refresh(token)]);

    expect(consumeMock).toHaveBeenCalledTimes(2);
    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
    if (results[1].status === 'rejected') {
      expect(results[1].reason).toBeInstanceOf(InvalidRefreshTokenError);
    }
  });
});
