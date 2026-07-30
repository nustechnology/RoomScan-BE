import { describe, expect, it, vi } from 'vitest';

import {
  LOCAL_TEST_APPLE_IDENTITY_TOKEN,
  LOCAL_TEST_APPLE_PROVIDER_ID,
  LOCAL_TEST_USER_EMAIL,
} from '../src/config/constants.js';
import { LocalTestAppleIdentityVerifier } from '../src/infrastructure/auth/local-test-apple-identity-verifier.js';
import type { AppleIdentityVerifier } from '../src/modules/auth/auth.types.js';

describe('LocalTestAppleIdentityVerifier', () => {
  it('returns the seeded identity without calling Apple when explicitly enabled', async () => {
    const verify = vi.fn<AppleIdentityVerifier['verify']>();
    const verifier = new LocalTestAppleIdentityVerifier({
      delegate: { verify },
      enabled: true,
    });

    await expect(
      verifier.verify(LOCAL_TEST_APPLE_IDENTITY_TOKEN, 'ignored-local-nonce'),
    ).resolves.toEqual({
      providerId: LOCAL_TEST_APPLE_PROVIDER_ID,
      email: LOCAL_TEST_USER_EMAIL,
      emailVerified: true,
    });
    expect(verify).not.toHaveBeenCalled();
  });

  it('delegates every non-local identity token to Apple verification', async () => {
    const identity = {
      providerId: 'real-apple-subject',
      email: 'real-user@example.com',
      emailVerified: true,
    };
    const verify = vi.fn<AppleIdentityVerifier['verify']>().mockResolvedValue(identity);
    const verifier = new LocalTestAppleIdentityVerifier({
      delegate: { verify },
      enabled: true,
    });

    await expect(verifier.verify('real-apple-token', 'client-nonce')).resolves.toBe(identity);
    expect(verify).toHaveBeenCalledWith('real-apple-token', 'client-nonce');
  });

  it('delegates the local sentinel when the shortcut is disabled', async () => {
    const identity = {
      providerId: 'verified-subject',
      email: null,
      emailVerified: false,
    };
    const verify = vi.fn<AppleIdentityVerifier['verify']>().mockResolvedValue(identity);
    const verifier = new LocalTestAppleIdentityVerifier({
      delegate: { verify },
      enabled: false,
    });

    await expect(verifier.verify(LOCAL_TEST_APPLE_IDENTITY_TOKEN)).resolves.toBe(identity);
    expect(verify).toHaveBeenCalledWith(LOCAL_TEST_APPLE_IDENTITY_TOKEN, undefined);
  });
});
