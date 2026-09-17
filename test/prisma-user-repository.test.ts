import { describe, expect, it, vi } from 'vitest';

import { PUBLIC_USER_ID_PATTERN } from '../src/common/identifiers/public-user-id.js';
import { Prisma, type PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaAppleUserRepository } from '../src/infrastructure/database/prisma-user-repository.js';

const PUBLIC_USER_ID = 'GP5HS2WKBE';
/** The generated id is random, so assertions match its shape rather than a value. */
const anyPublicUserId = expect.stringMatching(PUBLIC_USER_ID_PATTERN) as unknown as string;

function createRepository() {
  const upsert = vi
    .fn<
      (arguments_: unknown) => Promise<{
        id: string;
        publicId: string;
        email: string | null;
        displayName: string | null;
      }>
    >()
    .mockResolvedValue({
      id: 'eb5d278f-c857-45c7-887d-7be65288cb75',
      publicId: PUBLIC_USER_ID,
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
      publicUserId: PUBLIC_USER_ID,
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
        publicId: anyPublicUserId,
        email: 'user@example.com',
        emailVerified: true,
      },
      update: {
        email: 'user@example.com',
        emailVerified: true,
      },
      select: {
        id: true,
        publicId: true,
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
        publicId: anyPublicUserId,
        email: null,
        emailVerified: false,
      },
      update: {},
      select: {
        id: true,
        publicId: true,
        email: true,
        displayName: true,
      },
    });
  });

  it('retries with a fresh public id when the generated one already exists', async () => {
    const { repository, upsert } = createRepository();
    const collision = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['publicId'] },
    });
    upsert.mockRejectedValueOnce(collision);

    await expect(
      repository.upsertAppleUser({
        providerId: 'apple-subject',
        email: 'user@example.com',
        emailVerified: true,
      }),
    ).resolves.toMatchObject({ publicUserId: PUBLIC_USER_ID });
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it('rethrows a unique-constraint failure that is not about the public id', async () => {
    const { repository, upsert } = createRepository();
    const other = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['providerId'] },
    });
    upsert.mockRejectedValueOnce(other);

    await expect(
      repository.upsertAppleUser({
        providerId: 'apple-subject',
        email: 'user@example.com',
        emailVerified: true,
      }),
    ).rejects.toBe(other);
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('gives up after repeated public id collisions', async () => {
    const { repository, upsert } = createRepository();
    const collision = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['publicId'] },
    });
    upsert.mockRejectedValue(collision);

    await expect(
      repository.upsertAppleUser({
        providerId: 'apple-subject',
        email: 'user@example.com',
        emailVerified: true,
      }),
    ).rejects.toBe(collision);
    expect(upsert).toHaveBeenCalledTimes(5);
  });

  it('applies a displayName even when the Apple token has no email', async () => {
    const { repository, upsert } = createRepository();

    await repository.upsertAppleUser({
      providerId: 'apple-subject',
      email: null,
      emailVerified: false,
      displayName: 'Nguyen Minh Anh',
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
        publicId: anyPublicUserId,
        email: null,
        emailVerified: false,
        displayName: 'Nguyen Minh Anh',
      },
      update: {
        displayName: 'Nguyen Minh Anh',
      },
      select: {
        id: true,
        publicId: true,
        email: true,
        displayName: true,
      },
    });
  });
});
