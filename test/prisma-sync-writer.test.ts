import { describe, expect, it, vi } from 'vitest';
import { writeDeleteChangesBatch } from '../src/infrastructure/database/prisma-sync-writer.js';
import type { PrismaTransactionClient } from '../src/infrastructure/database/prisma-idempotency.js';

describe('writeDeleteChangesBatch', () => {
  const deletedAt = new Date('2026-08-18T10:00:00.000Z');
  const inputSample = {
    projectId: 'p-1',
    ownerId: 'u-1',
    resourceType: 'NOTE' as const,
    resourceId: 'n-1',
    revision: 2,
    deletedAt,
  };

  it('does nothing if transaction does not support sync', async () => {
    const tx = {} as PrismaTransactionClient;
    await expect(writeDeleteChangesBatch(tx, [inputSample])).resolves.toBeUndefined();
  });

  it('does nothing if inputs array is empty', async () => {
    const createMany = vi.fn();
    const tx = {
      syncChange: { create: vi.fn(), createMany },
    } as unknown as PrismaTransactionClient;

    await writeDeleteChangesBatch(tx, []);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('uses syncChange.createMany when available', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      syncChange: { create: vi.fn(), createMany },
    } as unknown as PrismaTransactionClient;

    await writeDeleteChangesBatch(tx, [inputSample]);

    expect(createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          projectId: 'p-1',
          ownerId: 'u-1',
          resourceType: 'NOTE',
          resourceId: 'n-1',
          operation: 'DELETE',
          revision: 2,
          deletedAt,
          changedAt: deletedAt,
        }),
      ],
    });
  });

  it('falls back to syncChange.create loop when createMany is not defined', async () => {
    const create = vi.fn().mockResolvedValue({ id: 1n });
    const tx = {
      syncChange: { create },
    } as unknown as PrismaTransactionClient;

    await writeDeleteChangesBatch(tx, [inputSample, { ...inputSample, resourceId: 'n-2' }]);

    expect(create).toHaveBeenCalledTimes(2);
    const firstCall = create.mock.calls[0]?.[0] as { data: { resourceId: string } } | undefined;
    const secondCall = create.mock.calls[1]?.[0] as { data: { resourceId: string } } | undefined;
    expect(firstCall?.data.resourceId).toBe('n-1');
    expect(secondCall?.data.resourceId).toBe('n-2');
  });
});
