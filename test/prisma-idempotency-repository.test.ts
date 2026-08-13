import { describe, expect, it, vi } from 'vitest';

import { Prisma } from '../src/generated/prisma/client.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { IdempotencyKeyInProgressError } from '../src/common/idempotency/idempotency.errors.js';
import { PrismaIdempotencyRepository } from '../src/infrastructure/database/prisma-idempotency-repository.js';

const USER_ID = 'eb5d278f-c857-45c7-887d-7be65288cb75';
const KEY = 'create-project-abc';
const NOW = new Date('2026-07-29T10:00:00.000Z');

function createRow() {
  return {
    id: 'idempotency-1',
    userId: USER_ID,
    key: KEY,
    requestHash: 'abc123',
    statusCode: 201,
    responseBody: { id: 'project-1' },
    createdAt: NOW,
    expiresAt: new Date(NOW.getTime() + 86_400_000),
  };
}

function createClient() {
  const idempotencyRecord = {
    findUnique: vi.fn().mockResolvedValue(createRow()),
    create: vi.fn().mockResolvedValue(createRow()),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const client = {
    idempotencyRecord,
  } as unknown as Pick<PrismaClient, 'idempotencyRecord'>;

  return { client, idempotencyRecord };
}

describe('PrismaIdempotencyRepository', () => {
  it('finds a record by user and key', async () => {
    const { client, idempotencyRecord } = createClient();
    const repository = new PrismaIdempotencyRepository(client);

    const result = await repository.findByUserAndKey(USER_ID, KEY);

    expect(idempotencyRecord.findUnique).toHaveBeenCalledWith({
      where: { userId_key: { userId: USER_ID, key: KEY } },
      select: {
        id: true,
        userId: true,
        key: true,
        requestHash: true,
        statusCode: true,
        responseBody: true,
        createdAt: true,
        expiresAt: true,
      },
    });
    expect(result).toMatchObject({
      userId: USER_ID,
      key: KEY,
      requestHash: 'abc123',
      statusCode: 201,
      responseBody: { id: 'project-1' },
    });
  });

  it('returns null when no record matches', async () => {
    const { client, idempotencyRecord } = createClient();
    idempotencyRecord.findUnique.mockResolvedValue(null);
    const repository = new PrismaIdempotencyRepository(client);

    await expect(repository.findByUserAndKey(USER_ID, KEY)).resolves.toBeNull();
  });

  it('reserves an in-progress record', async () => {
    const { client, idempotencyRecord } = createClient();
    const repository = new PrismaIdempotencyRepository(client);

    await repository.reserve({
      userId: USER_ID,
      key: KEY,
      requestHash: 'abc123',
      expiresAt: new Date(NOW.getTime() + 86_400_000),
    });

    expect(idempotencyRecord.create).toHaveBeenCalledWith({
      data: {
        userId: USER_ID,
        key: KEY,
        requestHash: 'abc123',
        statusCode: 0,
        responseBody: Prisma.JsonNull,
        expiresAt: new Date(NOW.getTime() + 86_400_000),
      },
    });
  });

  it('surfaces a unique-constraint violation as an in-progress conflict', async () => {
    const { client, idempotencyRecord } = createClient();
    const conflict = new Prisma.PrismaClientKnownRequestError('unique constraint', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['userId', 'key'] },
    });
    idempotencyRecord.create.mockRejectedValue(conflict);
    const repository = new PrismaIdempotencyRepository(client);

    await expect(
      repository.reserve({
        userId: USER_ID,
        key: KEY,
        requestHash: 'abc123',
        expiresAt: new Date(NOW.getTime() + 86_400_000),
      }),
    ).rejects.toBeInstanceOf(IdempotencyKeyInProgressError);
  });

  it('rethrows non-duplicate errors from reserve', async () => {
    const { client, idempotencyRecord } = createClient();
    idempotencyRecord.create.mockRejectedValue(new Error('boom'));
    const repository = new PrismaIdempotencyRepository(client);

    await expect(
      repository.reserve({
        userId: USER_ID,
        key: KEY,
        requestHash: 'abc123',
        expiresAt: new Date(NOW.getTime() + 86_400_000),
      }),
    ).rejects.toThrow('boom');
  });

  it('finalizes a record with the response status and body', async () => {
    const { client, idempotencyRecord } = createClient();
    const repository = new PrismaIdempotencyRepository(client);

    await repository.finalize(USER_ID, KEY, 201, { id: 'project-1' });

    expect(idempotencyRecord.updateMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, key: KEY },
      data: { statusCode: 201, responseBody: { id: 'project-1' } },
    });
  });

  it('releases a reserved record', async () => {
    const { client, idempotencyRecord } = createClient();
    const repository = new PrismaIdempotencyRepository(client);

    await repository.release(USER_ID, KEY);

    expect(idempotencyRecord.deleteMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, key: KEY },
    });
  });
});
