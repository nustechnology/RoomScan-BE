import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaRefreshTokenRepository } from '../src/infrastructure/database/prisma-refresh-token-repository.js';

const JTI = 'eb5d278f-c857-45c7-887d-7be65288cb75';
const NEW_JTI = '00000000-0000-4000-8000-000000000002';
const USER_ID = '8c53d31d-2788-48de-82a0-c4f219ca3701';
const FUTURE_DATE = new Date(Date.now() + 86_400_000);

function createRepository() {
  const create = vi.fn<(arguments_: unknown) => Promise<unknown>>();
  const updateMany = vi
    .fn<(arguments_: unknown) => Promise<{ count: number }>>()
    .mockResolvedValue({ count: 0 });
  const $transaction = vi
    .fn()
    .mockImplementation(
      async (callback: (tx: Pick<PrismaClient, 'refreshToken'>) => Promise<boolean>) =>
        callback({ refreshToken: { create, updateMany } } as unknown as Pick<
          PrismaClient,
          'refreshToken'
        >),
    );
  const client = {
    refreshToken: { create, updateMany },
    $transaction,
  } as unknown as Pick<PrismaClient, 'refreshToken' | '$transaction'>;

  return {
    repository: new PrismaRefreshTokenRepository(client),
    create,
    updateMany,
    $transaction,
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

  it('returns true when consuming an active unrevoked token', async () => {
    const { repository, updateMany } = createRepository();
    updateMany.mockResolvedValue({ count: 1 });

    const result = await repository.consume(JTI);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        jti: JTI,
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) as Date },
      },
      data: { revokedAt: expect.any(Date) as Date },
    });
    expect(result).toBe(true);
  });

  it('returns false when consuming an already-revoked token', async () => {
    const { repository, updateMany } = createRepository();
    updateMany.mockResolvedValue({ count: 0 });

    const result = await repository.consume(JTI);

    expect(result).toBe(false);
  });

  it('returns false when consuming an expired token', async () => {
    const { repository, updateMany } = createRepository();
    updateMany.mockResolvedValue({ count: 0 });

    const result = await repository.consume(JTI);

    expect(result).toBe(false);
  });

  it('returns false for an unknown JTI', async () => {
    const { repository, updateMany } = createRepository();
    updateMany.mockResolvedValue({ count: 0 });

    const result = await repository.consume('00000000-0000-0000-0000-000000000000');

    expect(result).toBe(false);
  });

  it('atomically consumes the old JTI and persists the replacement in rotate', async () => {
    const { repository, updateMany, create, $transaction } = createRepository();
    updateMany.mockResolvedValue({ count: 1 });

    const result = await repository.rotate(JTI, NEW_JTI, USER_ID, FUTURE_DATE);

    expect($transaction).toHaveBeenCalledOnce();
    expect(result).toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        jti: JTI,
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) as Date },
      },
      data: { revokedAt: expect.any(Date) as Date },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        jti: NEW_JTI,
        userId: USER_ID,
        expiresAt: FUTURE_DATE,
      },
    });
  });

  it('returns false from rotate when the old JTI is already consumed', async () => {
    const { repository, updateMany, create } = createRepository();
    updateMany.mockResolvedValue({ count: 0 });

    const result = await repository.rotate(JTI, NEW_JTI, USER_ID, FUTURE_DATE);

    expect(result).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });
});
