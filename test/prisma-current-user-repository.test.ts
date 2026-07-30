import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaCurrentUserRepository } from '../src/infrastructure/database/prisma-current-user-repository.js';

const USER_ID = 'eb5d278f-c857-45c7-887d-7be65288cb75';

describe('PrismaCurrentUserRepository', () => {
  it('loads the authenticated user by ID without exposing private fields', async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: USER_ID,
      email: 'user@example.com',
    });
    const client = {
      user: { findUnique },
    } as unknown as Pick<PrismaClient, 'user'>;
    const repository = new PrismaCurrentUserRepository(client);

    await expect(repository.findById(USER_ID)).resolves.toEqual({
      id: USER_ID,
      email: 'user@example.com',
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: USER_ID },
      select: {
        id: true,
        email: true,
      },
    });
  });

  it('returns null when the token subject no longer exists', async () => {
    const client = {
      user: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    } as unknown as Pick<PrismaClient, 'user'>;
    const repository = new PrismaCurrentUserRepository(client);

    await expect(repository.findById(USER_ID)).resolves.toBeNull();
  });
});
