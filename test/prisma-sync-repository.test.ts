import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaSyncRepository } from '../src/infrastructure/database/prisma-sync-repository.js';
import { decodeSyncCursor, encodeSyncCursor } from '../src/modules/sync/sync-cursor.js';

const USER_ID = 'eb5d278f-c857-45c7-887d-7be65288cb75';
const PROJECT_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const SCAN_ID = 'f1e2d3c4-a5b6-7890-abcd-ef1234567890';
const NOTE_ID = 'b1a2c3d4-e5f6-4890-abcd-ef1234567890';
const NOW = new Date('2026-07-29T10:00:00.000Z');

function visibleProjectWhere(userId: string) {
  return {
    OR: [
      { ownerId: userId },
      {
        accesses: {
          some: { userId, role: 'VIEWER', revokedAt: null },
        },
      },
    ],
  };
}

function createClient() {
  const project = {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
  };
  const scan = {
    findMany: vi.fn().mockResolvedValue([]),
  };
  const note = {
    findMany: vi.fn().mockResolvedValue([]),
  };
  const projectAccess = {};
  const transaction = vi.fn(async (operation: unknown) => {
    if (Array.isArray(operation)) {
      return Promise.all(operation);
    }
    return (
      operation as (client: {
        project: typeof project;
        scan: typeof scan;
        note: typeof note;
        projectAccess: typeof projectAccess;
      }) => Promise<unknown>
    )({ project, scan, note, projectAccess });
  });
  const client = {
    project,
    scan,
    note,
    projectAccess,
    $transaction: transaction,
  } as unknown as Pick<
    PrismaClient,
    'project' | 'scan' | 'note' | 'projectAccess' | '$transaction'
  >;

  return { client, project, scan, note, transaction };
}

describe('PrismaSyncRepository', () => {
  it('returns no changes when the user has no visible projects', async () => {
    const { client, transaction } = createClient();
    const repository = new PrismaSyncRepository(client);

    const result = await repository.listChanges(USER_ID, { limit: 20 });

    expect(result).toEqual({ changes: [], hasMore: false });
    expect(transaction).toHaveBeenCalledOnce();
  });

  it('merges project, scan, and note changes ordered newest-first', async () => {
    const { client, project, scan, note } = createClient();
    const older = new Date(NOW.getTime() - 1000);
    project.findMany.mockResolvedValue([
      { id: PROJECT_ID, updatedAt: NOW, deletedAt: null, revision: 2 },
    ]);
    scan.findMany.mockResolvedValue([
      { id: SCAN_ID, updatedAt: older, deletedAt: older, revision: 4, syncStatus: 'SYNCED' },
    ]);
    note.findMany.mockResolvedValue([
      { id: NOTE_ID, updatedAt: older, deletedAt: null, revision: 1 },
    ]);
    const repository = new PrismaSyncRepository(client);

    const result = await repository.listChanges(USER_ID, { limit: 20 });

    expect(project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ...visibleProjectWhere(USER_ID), ...{} },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: 21,
      }),
    );
    expect(scan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { project: visibleProjectWhere(USER_ID), ...{} },
      }),
    );
    expect(note.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { scan: { deletedAt: null, project: visibleProjectWhere(USER_ID) }, ...{} },
      }),
    );

    expect(result.changes.map((change) => change.resourceType)).toEqual([
      'project',
      'scan',
      'note',
    ]);
    expect(result.changes[0]).toMatchObject({
      resourceType: 'project',
      resourceId: PROJECT_ID,
      operation: 'UPDATE',
      revision: 2,
      syncStatus: null,
    });
    expect(result.changes[1]).toMatchObject({
      resourceType: 'scan',
      operation: 'DELETE',
      revision: 4,
      syncStatus: 'SYNCED',
      deletedAt: older,
    });
    expect(result.changes[2]).toMatchObject({
      resourceType: 'note',
      operation: 'CREATE',
      revision: 1,
    });
    expect(result.hasMore).toBe(false);
  });

  it('reports hasMore and encodes per-change cursors when the limit is exceeded', async () => {
    const { client, project } = createClient();
    project.findMany.mockResolvedValue([
      { id: PROJECT_ID, updatedAt: NOW, deletedAt: null, revision: 1 },
      {
        id: 'b2c3d4e5-f6a7-4901-bcde-f12345678901',
        updatedAt: new Date(NOW.getTime() - 500),
        deletedAt: null,
        revision: 1,
      },
    ]);
    const repository = new PrismaSyncRepository(client);

    const result = await repository.listChanges(USER_ID, { limit: 1 });

    expect(result.changes).toHaveLength(1);
    expect(result.hasMore).toBe(true);
    expect(result.changes[0]?.cursor).toBe(encodeSyncCursor(NOW, PROJECT_ID));
    expect(decodeSyncCursor(result.changes[0]?.cursor)).toEqual({
      updatedAt: NOW.getTime(),
      id: PROJECT_ID,
    });
  });

  it('applies a since filter when no cursor is provided', async () => {
    const { client, project } = createClient();
    const since = new Date(NOW.getTime() - 10_000);
    const repository = new PrismaSyncRepository(client);

    await repository.listChanges(USER_ID, { since, limit: 20 });

    expect(project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ...visibleProjectWhere(USER_ID), updatedAt: { gt: since } },
      }),
    );
  });

  it('applies a keyset cursor filter when a cursor is provided', async () => {
    const { client, project } = createClient();
    const cursor = encodeSyncCursor(NOW, PROJECT_ID);
    const repository = new PrismaSyncRepository(client);

    await repository.listChanges(USER_ID, { cursor, limit: 20 });

    expect(project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ...visibleProjectWhere(USER_ID),
          OR: [{ updatedAt: { lt: NOW } }, { updatedAt: NOW, id: { lt: PROJECT_ID } }],
        },
      }),
    );
  });

  it('computes project status from its active scans', async () => {
    const { client, project, scan } = createClient();
    project.findMany.mockResolvedValue([{ id: PROJECT_ID }]);
    scan.findMany.mockResolvedValue([
      { projectId: PROJECT_ID, syncStatus: 'SYNCED', updatedAt: NOW, _count: { assets: 1 } },
      { projectId: PROJECT_ID, syncStatus: 'PENDING', updatedAt: NOW, _count: { assets: 0 } },
    ]);
    const repository = new PrismaSyncRepository(client);

    const result = await repository.listProjectStatuses(USER_ID);

    expect(result).toEqual([
      {
        projectId: PROJECT_ID,
        syncStatus: 'PENDING',
        pendingCount: 1,
        syncingCount: 0,
        failedCount: 0,
        conflictCount: 0,
        lastSyncedAt: NOW,
        requiredAssetsUploaded: false,
      },
    ]);
    expect(scan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: { in: [PROJECT_ID] }, deletedAt: null },
      }),
    );
  });

  it('marks a project SYNCED only when every scan is synced', async () => {
    const { client, project, scan } = createClient();
    project.findMany.mockResolvedValue([{ id: PROJECT_ID }]);
    scan.findMany.mockResolvedValue([
      { projectId: PROJECT_ID, syncStatus: 'SYNCED', updatedAt: NOW, _count: { assets: 1 } },
    ]);
    const repository = new PrismaSyncRepository(client);

    const result = await repository.listProjectStatuses(USER_ID);

    expect(result[0]).toMatchObject({
      syncStatus: 'SYNCED',
      syncingCount: 0,
      requiredAssetsUploaded: true,
    });
  });

  it('returns an empty list when the user owns nothing', async () => {
    const { client } = createClient();
    const repository = new PrismaSyncRepository(client);

    const result = await repository.listProjectStatuses(USER_ID);

    expect(result).toEqual([]);
  });

  it('returns null for a project the user cannot access', async () => {
    const { client, project } = createClient();
    project.findFirst.mockResolvedValue(null);
    const repository = new PrismaSyncRepository(client);

    await expect(repository.findProjectStatus(USER_ID, PROJECT_ID)).resolves.toBeNull();
  });
});
