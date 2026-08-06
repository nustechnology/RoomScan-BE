import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaRefreshTokenRepository } from '../src/infrastructure/database/prisma-refresh-token-repository.js';

const JTI = 'eb5d278f-c857-45c7-887d-7be65288cb75';
const USER_ID = '8c53d31d-2788-48de-82a0-c4f219ca3701';
const FUTURE_DATE = new Date('2027-01-01T00:00:00.000Z');
const PAST_DATE = new Date('2020-01-01T00:00:00.000Z');

function createRepository() {
  const create = vi.fn<(arguments_: unknown) => Promise<unknown>>();
  const findFirst = vi
    .fn<(arguments_: unknown) => Promise<{ userId: string; expiresAt: Date } | null>>()
    .mockResolvedValue(null);
  const updateMany = vi.fn<(arguments_: unknown) => Promise<unknown>>();
  const client = {
    refreshToken: {
      create,
      findFirst,
      updateMany,
    },
  } as unknown as Pick<PrismaClient, 'refreshToken'>;

  return {
    repository: new PrismaRefreshTokenRepository(client),
    create,
    findFirst,
    updateMany,
  };
}

describe('PrismaRefreshTokenRepository', () => {
  it('persists a refresh token record', async () => {
    const { repository, create } = createRepository();

    await repository.saveToken(JTI, USER_ID, FUTURE_DATE);

    expect(create).toHaveBeenCalledWith({
      data: {
        jti: JTI,
        userId: USER_ID,
        expiresAt: FUTURE_DATE,
      },
    });
  });

  it('returns an active token by JTI', async () => {
    const { repository, findFirst } = createRepository();
    findFirst.mockResolvedValue({
      userId: USER_ID,
      expiresAt: FUTURE_DATE,
    });

    const result = await repository.findActiveByJti(JTI);

    expect(findFirst).toHaveBeenCalledWith({
      where: { jti: JTI, revokedAt: null },
      select: { userId: true, expiresAt: true },
    });
    expect(result).toEqual({
      userId: USER_ID,
      expiresAt: FUTURE_DATE,
    });
  });

  it('returns null for a revoked token', async () => {
    const { repository, findFirst } = createRepository();
    findFirst.mockResolvedValue(null);

    const result = await repository.findActiveByJti(JTI);

    expect(result).toBeNull();
  });

  it('returns null for an expired token', async () => {
    const { repository, findFirst } = createRepository();
    findFirst.mockResolvedValue({
      userId: USER_ID,
      expiresAt: PAST_DATE,
    });

    const result = await repository.findActiveByJti(JTI);

    expect(result).toBeNull();
  });

  it('returns null for an unknown JTI', async () => {
    const { repository, findFirst } = createRepository();
    findFirst.mockResolvedValue(null);

    const result = await repository.findActiveByJti('00000000-0000-0000-0000-000000000000');

    expect(result).toBeNull();
  });

  it('revokes a non-revoked token by JTI', async () => {
    const { repository, updateMany } = createRepository();

    await repository.revokeByJti(JTI);

    expect(updateMany).toHaveBeenCalledWith({
      where: { jti: JTI, revokedAt: null },
      data: { revokedAt: expect.any(Date) as Date },
    });
  });
});
