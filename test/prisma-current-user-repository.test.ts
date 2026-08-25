import { describe, expect, it, vi } from 'vitest';

import { Prisma, type PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaCurrentUserRepository } from '../src/infrastructure/database/prisma-current-user-repository.js';

const USER_ID = 'eb5d278f-c857-45c7-887d-7be65288cb75';

describe('PrismaCurrentUserRepository', () => {
  it('loads the authenticated user by ID without exposing private fields', async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: USER_ID,
      email: 'user@example.com',
      displayName: null,
    });
    const client = {
      user: { findUnique, update: vi.fn() },
    } as unknown as Pick<PrismaClient, 'user'>;
    const repository = new PrismaCurrentUserRepository(client);

    await expect(repository.findById(USER_ID)).resolves.toEqual({
      id: USER_ID,
      email: 'user@example.com',
      displayName: null,
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: USER_ID },
      select: {
        id: true,
        email: true,
        displayName: true,
      },
    });
  });

  it('returns null when the token subject no longer exists', async () => {
    const client = {
      user: {
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    } as unknown as Pick<PrismaClient, 'user'>;
    const repository = new PrismaCurrentUserRepository(client);

    await expect(repository.findById(USER_ID)).resolves.toBeNull();
  });

  it('updates the displayName and returns the refreshed profile', async () => {
    const update = vi.fn().mockResolvedValue({
      id: USER_ID,
      email: 'user@example.com',
      displayName: 'Nguyen Minh Anh',
    });
    const client = {
      user: { findUnique: vi.fn(), update },
    } as unknown as Pick<PrismaClient, 'user'>;
    const repository = new PrismaCurrentUserRepository(client);

    await expect(repository.updateDisplayName(USER_ID, 'Nguyen Minh Anh')).resolves.toEqual({
      id: USER_ID,
      email: 'user@example.com',
      displayName: 'Nguyen Minh Anh',
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { displayName: 'Nguyen Minh Anh' },
      select: {
        id: true,
        email: true,
        displayName: true,
      },
    });
  });

  it('returns null when updating a user that no longer exists', async () => {
    const notFound = new Prisma.PrismaClientKnownRequestError('No record found', {
      code: 'P2025',
      clientVersion: 'test',
    });
    const update = vi.fn().mockRejectedValue(notFound);
    const client = {
      user: { findUnique: vi.fn(), update },
    } as unknown as Pick<PrismaClient, 'user'>;
    const repository = new PrismaCurrentUserRepository(client);

    await expect(repository.updateDisplayName(USER_ID, 'Name')).resolves.toBeNull();
  });

  it('rethrows non-P2025 errors from update', async () => {
    const update = vi.fn().mockRejectedValue(new Error('boom'));
    const client = {
      user: { findUnique: vi.fn(), update },
    } as unknown as Pick<PrismaClient, 'user'>;
    const repository = new PrismaCurrentUserRepository(client);

    await expect(repository.updateDisplayName(USER_ID, 'Name')).rejects.toThrow('boom');
  });
});
