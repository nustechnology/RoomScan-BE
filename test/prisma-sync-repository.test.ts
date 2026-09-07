import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaSyncRepository } from '../src/infrastructure/database/prisma-sync-repository.js';

const USER_ID = 'eb5d278f-c857-45c7-887d-7be65288cb75';
const PROJECT_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const SCAN_ID = 'f1e2d3c4-a5b6-7890-abcd-ef1234567890';
const NOW = new Date('2026-08-17T04:00:00.000Z');

function rawChange(id: bigint, resourceId = PROJECT_ID) {
  return {
    id,
    resourceType: 'PROJECT' as const,
    resourceId,
    operation: 'UPSERT' as const,
    revision: 3,
    syncStatus: 'SYNCED' as const,
    data: { id: resourceId, name: 'Room' },
    deletedAt: null,
    changedAt: NOW,
  };
}

describe('PrismaSyncRepository', () => {
  it('returns zero or the latest immutable change sequence as the watermark', async () => {
    const findFirst = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 42n });
    const repository = new PrismaSyncRepository({
      syncChange: { findFirst },
    } as unknown as PrismaClient);

    await expect(repository.getWatermark()).resolves.toBe(0n);
    await expect(repository.getWatermark()).resolves.toBe(42n);
  });

  it('maps snapshot rows, removes the lookahead row, and reports whether another page exists', async () => {
    const queryRaw = vi
      .fn()
      .mockResolvedValue([rawChange(1n), rawChange(2n, SCAN_ID), rawChange(3n)]);
    const repository = new PrismaSyncRepository({ $queryRaw: queryRaw } as unknown as PrismaClient);

    const result = await repository.listSnapshot(
      USER_ID,
      100n,
      { resourceType: 'PROJECT', resourceId: PROJECT_ID },
      2,
    );

    expect(result.hasMore).toBe(true);
    expect(result.items).toEqual([
      expect.objectContaining({ sequence: 1n, data: { id: PROJECT_ID, name: 'Room' } }),
      expect.objectContaining({ sequence: 2n, resourceId: SCAN_ID }),
    ]);
  });

  it('maps incremental delete rows and redacts non-object snapshot data to null', async () => {
    const queryRaw = vi.fn().mockResolvedValue([
      {
        ...rawChange(5n),
        operation: 'DELETE',
        data: ['not', 'a', 'dto'],
        deletedAt: NOW,
      },
    ]);
    const repository = new PrismaSyncRepository({ $queryRaw: queryRaw } as unknown as PrismaClient);

    const result = await repository.listIncremental(USER_ID, 4n, 10n, NOW, 10);

    expect(result.items).toEqual([
      expect.objectContaining({ sequence: 5n, operation: 'DELETE', data: null, deletedAt: NOW }),
    ]);
  });

  it('computes status counts and priority for projects the user owns', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: PROJECT_ID,
        lastSyncedAt: null,
        scans: [
          { assets: [] },
          { assets: [{ status: 'UPLOADING' }] },
          { assets: [{ status: 'FAILED' }] },
          { assets: [{ status: 'UPLOADED' }] },
        ],
        _count: { syncConflicts: 1 },
      },
      {
        id: SCAN_ID,
        lastSyncedAt: NOW,
        scans: [],
        _count: { syncConflicts: 0 },
      },
    ]);
    const repository = new PrismaSyncRepository({
      project: { findMany },
    } as unknown as PrismaClient);

    const result = await repository.listStatuses(USER_ID);

    const [findArguments] = findMany.mock.calls[0] as unknown as [
      { where: { deletedAt: unknown; ownerId: unknown } },
    ];
    expect(findArguments.where.deletedAt).toBeNull();
    expect(findArguments.where.ownerId).toBe(USER_ID);
    expect(result[0]).toEqual({
      projectId: PROJECT_ID,
      syncStatus: 'CONFLICT',
      pendingCount: 1,
      syncingCount: 1,
      failedCount: 1,
      conflictCount: 1,
      lastSyncedAt: null,
      requiredAssetsUploaded: false,
    });
    expect(result[1]).toMatchObject({
      syncStatus: 'SYNCED',
      requiredAssetsUploaded: true,
      lastSyncedAt: NOW.toISOString(),
    });
  });

  it('scopes status lookup to projects owned by the user, excluding shared ones', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: PROJECT_ID,
        lastSyncedAt: null,
        scans: [{ assets: [{ status: 'UPLOADED' }] }],
        _count: { syncConflicts: 0 },
      },
    ]);
    const repository = new PrismaSyncRepository({
      project: { findMany },
    } as unknown as PrismaClient);

    const result = await repository.listStatuses(USER_ID, PROJECT_ID);

    const [findArguments] = findMany.mock.calls[0] as unknown as [
      { where: { id: string; ownerId: string; deletedAt: null } },
    ];
    expect(findArguments.where).toEqual({
      deletedAt: null,
      ownerId: USER_ID,
      id: PROJECT_ID,
    });
    expect(result).toHaveLength(1);
  });

  it('acknowledges refresh events, marks a ready project synced, and emits a targeted snapshot', async () => {
    const conflict = {
      projectId: PROJECT_ID,
      resourceType: 'PROJECT' as const,
      resourceId: PROJECT_ID,
    };
    const syncConflict = {
      findMany: vi.fn().mockResolvedValue([conflict]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    };
    const project = {
      findFirst: vi.fn().mockResolvedValue({
        scans: [{ assets: [{ status: 'UPLOADED' }] }],
      }),
      update: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue({ ownerId: USER_ID, revision: 3, deletedAt: null }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: PROJECT_ID,
        ownerId: USER_ID,
        owner: { email: 'owner@example.com' },
        name: 'Room',
        description: null,
        revision: 3,
        syncStatus: 'SYNCED',
        lastSyncedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      }),
    };
    const syncChange = {
      create: vi.fn().mockResolvedValue({ id: 51n }),
    };
    const transaction = vi.fn(
      async (work: (tx: unknown) => Promise<unknown>) =>
        await work({ syncConflict, project, syncChange }),
    );
    const repository = new PrismaSyncRepository({
      syncConflict,
      $transaction: transaction,
    } as unknown as PrismaClient);

    await repository.acknowledge(USER_ID, 50n, NOW);

    expect(syncConflict.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { resolvedAt: NOW } }),
    );
    expect(project.update).toHaveBeenCalledWith({
      where: { id: PROJECT_ID },
      data: {
        syncStatus: 'SYNCED',
        lastSyncedAt: NOW,
        revision: { increment: 1 },
        updatedAt: NOW,
      },
    });
    const projectUpsertCall = syncChange.create.mock.calls.find(
      (call) => (call[0] as { data: { resourceType: string } }).data.resourceType === 'PROJECT',
    );
    expect(projectUpsertCall).toBeDefined();
    const changeArguments = projectUpsertCall![0] as { data: Record<string, unknown> };
    expect(changeArguments.data).toMatchObject({
      syncStatus: 'SYNCED',
    });
  });

  it('does nothing when no unresolved refresh event is covered by the cursor', async () => {
    const transaction = vi.fn();
    const repository = new PrismaSyncRepository({
      syncConflict: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: transaction,
    } as unknown as PrismaClient);

    await repository.acknowledge(USER_ID, 5n, NOW);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('lists a snapshot without a cursor and reports when no further page exists', async () => {
    const queryRaw = vi.fn().mockResolvedValue([rawChange(1n)]);
    const repository = new PrismaSyncRepository({ $queryRaw: queryRaw } as unknown as PrismaClient);

    const result = await repository.listSnapshot(USER_ID, 100n, null, 5);

    expect(result.hasMore).toBe(false);
    expect(result.items).toEqual([expect.objectContaining({ sequence: 1n })]);
    expect(queryRaw).toHaveBeenCalledOnce();
  });

  it('reports no further page when the lookahead row fits exactly within the limit', async () => {
    const queryRaw = vi.fn().mockResolvedValue([rawChange(1n)]);
    const repository = new PrismaSyncRepository({ $queryRaw: queryRaw } as unknown as PrismaClient);

    const result = await repository.listSnapshot(USER_ID, 100n, null, 1);

    expect(result.hasMore).toBe(false);
    expect(result.items).toHaveLength(1);
  });

  it('lists incremental changes without a since filter', async () => {
    const queryRaw = vi.fn().mockResolvedValue([rawChange(5n)]);
    const repository = new PrismaSyncRepository({ $queryRaw: queryRaw } as unknown as PrismaClient);

    const result = await repository.listIncremental(USER_ID, 4n, 10n, null, 10);

    expect(result.items).toEqual([expect.objectContaining({ sequence: 5n })]);
    expect(queryRaw).toHaveBeenCalledOnce();
  });

  it('redacts null snapshot data to null in the record mapping', async () => {
    const queryRaw = vi
      .fn()
      .mockResolvedValue([{ ...rawChange(7n), operation: 'DELETE' as const, data: null }]);
    const repository = new PrismaSyncRepository({ $queryRaw: queryRaw } as unknown as PrismaClient);

    const result = await repository.listIncremental(USER_ID, 6n, 8n, null, 10);

    expect(result.items).toEqual([expect.objectContaining({ sequence: 7n, data: null })]);
  });
});
