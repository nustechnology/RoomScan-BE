import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../src/generated/prisma/client.js';
import {
  LOCAL_TEST_APPLE_PROVIDER_ID,
  LOCAL_TEST_USER_EMAIL,
  LOCAL_TEST_USER_ID,
} from '../src/config/constants.js';
import { seedLocalTestUser } from '../src/infrastructure/database/local-test-user-seed.js';

describe('seedLocalTestUser', () => {
  it('idempotently creates or refreshes the fixed local Apple user', async () => {
    const upsert = vi.fn().mockResolvedValue({
      id: LOCAL_TEST_USER_ID,
      email: LOCAL_TEST_USER_EMAIL,
    });
    const client = {
      user: { upsert },
    } as unknown as Pick<PrismaClient, 'user'>;

    await expect(seedLocalTestUser(client)).resolves.toEqual({
      id: LOCAL_TEST_USER_ID,
      email: LOCAL_TEST_USER_EMAIL,
    });
    expect(upsert).toHaveBeenCalledWith({
      where: {
        provider_providerId: {
          provider: 'APPLE',
          providerId: LOCAL_TEST_APPLE_PROVIDER_ID,
        },
      },
      create: {
        id: LOCAL_TEST_USER_ID,
        provider: 'APPLE',
        providerId: LOCAL_TEST_APPLE_PROVIDER_ID,
        email: LOCAL_TEST_USER_EMAIL,
        emailVerified: true,
      },
      update: {
        email: LOCAL_TEST_USER_EMAIL,
        emailVerified: true,
      },
      select: {
        id: true,
        email: true,
      },
    });
  });
});
