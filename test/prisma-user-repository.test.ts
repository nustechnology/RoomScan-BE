import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaAppleUserRepository } from '../src/infrastructure/database/prisma-user-repository.js';

function createRepository() {
  const upsert = vi
    .fn<
      (arguments_: unknown) => Promise<{
        id: string;
        email: string | null;
        displayName: string | null;
      }>
    >()
    .mockResolvedValue({
      id: 'eb5d278f-c857-45c7-887d-7be65288cb75',
      email: 'user@example.com',
      displayName: null,
    });
  const client = {
    user: {
      upsert,
    },
  } as unknown as Pick<PrismaClient, 'user'>;

  return {
    repository: new PrismaAppleUserRepository(client),
    upsert,
  };
}

describe('PrismaAppleUserRepository', () => {
  it('atomically upserts an Apple user by provider and subject', async () => {
    const { repository, upsert } = createRepository();

    await expect(
      repository.upsertAppleUser({
        providerId: 'apple-subject',
        email: 'user@example.com',
        emailVerified: true,
      }),
    ).resolves.toEqual({
      id: 'eb5d278f-c857-45c7-887d-7be65288cb75',
      email: 'user@example.com',
      displayName: null,
      provider: 'apple',
    });
    expect(upsert).toHaveBeenCalledWith({
      where: {
        provider_providerId: {
          provider: 'APPLE',
          providerId: 'apple-subject',
        },
      },
      create: {
        provider: 'APPLE',
        providerId: 'apple-subject',
        email: 'user@example.com',
        emailVerified: true,
      },
      update: {
        email: 'user@example.com',
        emailVerified: true,
      },
      select: {
        id: true,
        email: true,
        displayName: true,
      },
    });
  });

  it('preserves stored email fields when the Apple token has no email', async () => {
    const { repository, upsert } = createRepository();

    await repository.upsertAppleUser({
      providerId: 'apple-subject',
      email: null,
      emailVerified: false,
    });

    expect(upsert).toHaveBeenCalledWith({
      where: {
        provider_providerId: {
          provider: 'APPLE',
          providerId: 'apple-subject',
        },
      },
      create: {
        provider: 'APPLE',
        providerId: 'apple-subject',
        email: null,
        emailVerified: false,
      },
      update: {},
      select: {
        id: true,
        email: true,
        displayName: true,
      },
    });
  });
});
