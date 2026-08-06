import { describe, expect, it, vi } from 'vitest';

import { AuthService } from '../src/modules/auth/auth.service.js';
import type {
  AppleIdentityVerifier,
  AppleUserRepository,
  AuthTokenIssuer,
  RefreshTokenRepository,
} from '../src/modules/auth/auth.types.js';

describe('AuthService', () => {
  it('verifies the Apple identity, provisions the user, persists the refresh JTI and issues application tokens', async () => {
    const verify = vi.fn<AppleIdentityVerifier['verify']>().mockResolvedValue({
      providerId: 'apple-subject',
      email: 'user@example.com',
      emailVerified: true,
    });
    const upsertAppleUser = vi.fn<AppleUserRepository['upsertAppleUser']>().mockResolvedValue({
      id: 'eb5d278f-c857-45c7-887d-7be65288cb75',
      email: 'user@example.com',
      provider: 'apple',
    });
    const issueTokens = vi.fn<AuthTokenIssuer['issueTokens']>().mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      refreshTokenJti: 'eb5d278f-c857-45c7-887d-7be65288cb75',
      refreshTokenExpiresAt: new Date('2026-08-05T10:00:00.000Z'),
    });
    const saveToken = vi.fn<RefreshTokenRepository['saveToken']>();
    const service = new AuthService({
      appleIdentityVerifier: { verify },
      userRepository: { upsertAppleUser },
      tokenIssuer: { issueTokens },
      tokenRepository: { saveToken, findActiveByJti: vi.fn(), revokeByJti: vi.fn() },
    });

    await expect(service.signInWithApple('identity-token')).resolves.toEqual({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      user: {
        id: 'eb5d278f-c857-45c7-887d-7be65288cb75',
        email: 'user@example.com',
        provider: 'apple',
      },
    });
    expect(verify).toHaveBeenCalledWith('identity-token', undefined);
    expect(upsertAppleUser).toHaveBeenCalledWith({
      providerId: 'apple-subject',
      email: 'user@example.com',
      emailVerified: true,
    });
    expect(issueTokens).toHaveBeenCalledWith('eb5d278f-c857-45c7-887d-7be65288cb75');
    expect(saveToken).toHaveBeenCalledWith(
      'eb5d278f-c857-45c7-887d-7be65288cb75',
      'eb5d278f-c857-45c7-887d-7be65288cb75',
      new Date('2026-08-05T10:00:00.000Z'),
    );
  });

  it('stops provisioning when Apple identity verification fails', async () => {
    const verificationError = new Error('verification failed');
    const verify = vi.fn<AppleIdentityVerifier['verify']>().mockRejectedValue(verificationError);
    const upsertAppleUser = vi.fn<AppleUserRepository['upsertAppleUser']>();
    const issueTokens = vi.fn<AuthTokenIssuer['issueTokens']>();
    const saveToken = vi.fn<RefreshTokenRepository['saveToken']>();
    const service = new AuthService({
      appleIdentityVerifier: { verify },
      userRepository: { upsertAppleUser },
      tokenIssuer: { issueTokens },
      tokenRepository: { saveToken, findActiveByJti: vi.fn(), revokeByJti: vi.fn() },
    });

    await expect(service.signInWithApple('identity-token')).rejects.toBe(verificationError);
    expect(upsertAppleUser).not.toHaveBeenCalled();
    expect(issueTokens).not.toHaveBeenCalled();
    expect(saveToken).not.toHaveBeenCalled();
  });

  it('threads a client nonce through to the identity verifier', async () => {
    const verify = vi.fn<AppleIdentityVerifier['verify']>().mockResolvedValue({
      providerId: 'apple-subject',
      email: 'user@example.com',
      emailVerified: true,
    });
    const upsertAppleUser = vi.fn<AppleUserRepository['upsertAppleUser']>().mockResolvedValue({
      id: 'eb5d278f-c857-45c7-887d-7be65288cb75',
      email: 'user@example.com',
      provider: 'apple',
    });
    const issueTokens = vi.fn<AuthTokenIssuer['issueTokens']>().mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      refreshTokenJti: 'eb5d278f-c857-45c7-887d-7be65288cb75',
      refreshTokenExpiresAt: new Date('2026-08-05T10:00:00.000Z'),
    });
    const saveToken = vi.fn<RefreshTokenRepository['saveToken']>();
    const service = new AuthService({
      appleIdentityVerifier: { verify },
      userRepository: { upsertAppleUser },
      tokenIssuer: { issueTokens },
      tokenRepository: { saveToken, findActiveByJti: vi.fn(), revokeByJti: vi.fn() },
    });

    await service.signInWithApple('identity-token', 'client-nonce');

    expect(verify).toHaveBeenCalledWith('identity-token', 'client-nonce');
  });

  it('does not issue tokens when user provisioning fails', async () => {
    const repositoryError = new Error('repository failed');
    const verify = vi.fn<AppleIdentityVerifier['verify']>().mockResolvedValue({
      providerId: 'apple-subject',
      email: null,
      emailVerified: false,
    });
    const upsertAppleUser = vi
      .fn<AppleUserRepository['upsertAppleUser']>()
      .mockRejectedValue(repositoryError);
    const issueTokens = vi.fn<AuthTokenIssuer['issueTokens']>();
    const saveToken = vi.fn<RefreshTokenRepository['saveToken']>();
    const service = new AuthService({
      appleIdentityVerifier: { verify },
      userRepository: { upsertAppleUser },
      tokenIssuer: { issueTokens },
      tokenRepository: { saveToken, findActiveByJti: vi.fn(), revokeByJti: vi.fn() },
    });

    await expect(service.signInWithApple('identity-token')).rejects.toBe(repositoryError);
    expect(issueTokens).not.toHaveBeenCalled();
    expect(saveToken).not.toHaveBeenCalled();
  });
});
