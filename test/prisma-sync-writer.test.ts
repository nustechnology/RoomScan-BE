import { describe, expect, it, vi } from 'vitest';
import {
  hasProjectSyncState,
  refreshProjectRollup,
  refreshScanRollup,
  resetProjectSyncState,
  resolveSyncConflict,
  syncStatusForAsset,
  upsertSyncConflict,
  writeAccessUpsert,
  writeAssetUpsert,
  writeDeleteChange,
  writeDeleteChangesBatch,
  writeNoteUpsert,
  writeProjectBootstrap,
  writeProjectUpsert,
  writeScanUpsert,
} from '../src/infrastructure/database/prisma-sync-writer.js';
import type { PrismaTransactionClient } from '../src/infrastructure/database/prisma-idempotency.js';

const PROJECT_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const OWNER_ID = 'eb5d278f-c857-45c7-887d-7be65288cb75';
const SCAN_ID = 'f1e2d3c4-a5b6-7890-abcd-ef1234567890';
const NOTE_ID = 'b1a2c3d4-e5f6-4890-abcd-ef1234567890';
const ASSET_ID = 'c1d2e3f4-a5b6-7890-abcd-ef1234567890';
const ACCESS_ID = 'd1e2f3a4-b5c6-7890-abcd-ef1234567890';
const NOW = new Date('2026-08-18T10:00:00.000Z');

function createProjectRow() {
  return {
    id: PROJECT_ID,
    ownerId: OWNER_ID,
    owner: { email: 'owner@example.com' },
    name: 'Apartment',
    description: null,
    revision: 2,
    syncStatus: 'SYNCED',
    lastSyncedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    scans: [],
  };
}

function createScanRow() {
  return {
    id: SCAN_ID,
    projectId: PROJECT_ID,
    project: { ownerId: OWNER_ID },
    createdById: OWNER_ID,
    creator: { email: 'owner@example.com' },
    name: 'Living Room',
    description: null,
    thumbnail: null,
    assetStatus: 'UPLOADED',
    syncStatus: 'SYNCED',
    modelVersion: 1,
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function createNoteRow() {
  return {
    id: NOTE_ID,
    scanId: SCAN_ID,
    scan: { projectId: PROJECT_ID, project: { ownerId: OWNER_ID } },
    createdById: OWNER_ID,
    creator: { email: 'owner@example.com' },
    content: 'Cabinet hinge is loose',
    color: 'YELLOW',
    position: { x: 1, y: 2, z: 3 },
    orientation: null,
    modelVersion: '1',
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function createAssetRow() {
  return {
    id: ASSET_ID,
    scanId: SCAN_ID,
    scan: { projectId: PROJECT_ID, project: { ownerId: OWNER_ID } },
    assetType: 'MODEL',
    revision: 1,
    status: 'UPLOADED',
    contentType: 'model/usdz',
    sizeBytes: 10,
    checksum: 'abc',
    modelVersion: '1',
    uploadedAt: NOW,
    uploadUrlExpiresAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function createAccessRow() {
  return {
    id: ACCESS_ID,
    projectId: PROJECT_ID,
    project: { ownerId: OWNER_ID },
    userId: '8c53d31d-2788-48de-82a0-c4f219ca3701',
    user: { email: 'viewer@example.com' },
    role: 'VIEWER',
    acceptedAt: NOW,
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function createFullTransaction() {
  const syncChange = {
    create: vi.fn().mockResolvedValue({ id: 1n }),
    createMany: vi.fn().mockResolvedValue({ count: 1 }),
    count: vi.fn().mockResolvedValue(1),
    deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const syncConflict = {
    upsert: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const project = {
    findUniqueOrThrow: vi.fn().mockResolvedValue(createProjectRow()),
    update: vi.fn().mockResolvedValue({}),
  };
  const scan = {
    findUniqueOrThrow: vi.fn().mockResolvedValue(createScanRow()),
    update: vi.fn().mockResolvedValue({}),
  };
  const note = {
    findUniqueOrThrow: vi.fn().mockResolvedValue(createNoteRow()),
  };
  const scanAsset = {
    findUniqueOrThrow: vi.fn().mockResolvedValue(createAssetRow()),
  };
  const projectAccess = {
    findUniqueOrThrow: vi.fn().mockResolvedValue(createAccessRow()),
  };

  const transaction = {
    syncChange,
    syncConflict,
    project,
    scan,
    note,
    scanAsset,
    projectAccess,
  } as unknown as PrismaTransactionClient;

  return { transaction, syncChange, syncConflict, project, scan, note, scanAsset, projectAccess };
}

describe('syncStatusForAsset', () => {
  it('maps upload lifecycle states to sync status', () => {
    expect(syncStatusForAsset('UPLOADING')).toBe('SYNCING');
    expect(syncStatusForAsset('UPLOADED')).toBe('SYNCED');
    expect(syncStatusForAsset('FAILED')).toBe('FAILED');
    expect(syncStatusForAsset('NONE')).toBe('PENDING');
    expect(syncStatusForAsset('PENDING')).toBe('PENDING');
  });
});

describe('writeDeleteChange', () => {
  it('writes a targeted delete tombstone', async () => {
    const { transaction, syncChange } = createFullTransaction();
    const deletedAt = new Date('2026-08-18T11:00:00.000Z');

    await writeDeleteChange(transaction, {
      projectId: PROJECT_ID,
      ownerId: OWNER_ID,
      targetUserId: 'target-user',
      resourceType: 'NOTE',
      resourceId: NOTE_ID,
      revision: 2,
      deletedAt,
      syncStatus: 'CONFLICT',
    });

    expect(syncChange.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: PROJECT_ID,
        ownerId: OWNER_ID,
        targetUserId: 'target-user',
        resourceType: 'NOTE',
        resourceId: NOTE_ID,
        operation: 'DELETE',
        revision: 2,
        syncStatus: 'CONFLICT',
        deletedAt,
        changedAt: deletedAt,
      }) as Record<string, unknown>,
      select: { id: true },
    });
  });

  it('omits targetUserId and defaults syncStatus when absent', async () => {
    const { transaction, syncChange } = createFullTransaction();
    const deletedAt = new Date('2026-08-18T11:00:00.000Z');

    await writeDeleteChange(transaction, {
      projectId: PROJECT_ID,
      ownerId: OWNER_ID,
      resourceType: 'SCAN',
      resourceId: SCAN_ID,
      revision: 3,
      deletedAt,
    });

    const data = syncChange.create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(data.data.targetUserId).toBeUndefined();
    expect(data.data.syncStatus).toBe('SYNCED');
  });
});

describe('writeDeleteChangesBatch', () => {
  const deletedAt = new Date('2026-08-18T10:00:00.000Z');
  const inputSample = {
    projectId: PROJECT_ID,
    ownerId: OWNER_ID,
    resourceType: 'NOTE' as const,
    resourceId: NOTE_ID,
    revision: 2,
    deletedAt,
  };

  it('does nothing if transaction does not support sync', async () => {
    const tx = {} as PrismaTransactionClient;
    await expect(writeDeleteChangesBatch(tx, [inputSample])).resolves.toBeUndefined();
  });

  it('does nothing if inputs array is empty', async () => {
    const { transaction, syncChange } = createFullTransaction();

    await writeDeleteChangesBatch(transaction, []);
    expect(syncChange.createMany).not.toHaveBeenCalled();
  });

  it('uses syncChange.createMany when available', async () => {
    const { transaction, syncChange } = createFullTransaction();

    await writeDeleteChangesBatch(transaction, [inputSample]);

    expect(syncChange.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          projectId: PROJECT_ID,
          ownerId: OWNER_ID,
          resourceType: 'NOTE',
          resourceId: NOTE_ID,
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
    expect(firstCall?.data.resourceId).toBe(NOTE_ID);
    expect(secondCall?.data.resourceId).toBe('n-2');
  });
});

describe('sync conflict ledger', () => {
  it('upserts a conflict record with create payload', async () => {
    const { transaction, syncConflict } = createFullTransaction();

    await upsertSyncConflict(transaction, {
      userId: OWNER_ID,
      projectId: PROJECT_ID,
      resourceType: 'NOTE',
      resourceId: NOTE_ID,
      serverRevision: 3,
      refreshChangeId: 1n,
    });

    expect(syncConflict.upsert).toHaveBeenCalledWith({
      where: {
        userId_resourceType_resourceId: {
          userId: OWNER_ID,
          resourceType: 'NOTE',
          resourceId: NOTE_ID,
        },
      },
      create: {
        userId: OWNER_ID,
        projectId: PROJECT_ID,
        resourceType: 'NOTE',
        resourceId: NOTE_ID,
        serverRevision: 3,
        refreshChangeId: 1n,
      },
      update: {
        projectId: PROJECT_ID,
        serverRevision: 3,
        refreshChangeId: 1n,
        resolvedAt: null,
      },
    });
  });

  it('resolves conflicts for a resource', async () => {
    const { transaction, syncConflict } = createFullTransaction();

    await resolveSyncConflict(transaction, OWNER_ID, 'NOTE', NOTE_ID, NOW);

    expect(syncConflict.updateMany).toHaveBeenCalledWith({
      where: { userId: OWNER_ID, resourceType: 'NOTE', resourceId: NOTE_ID, resolvedAt: null },
      data: { resolvedAt: NOW },
    });
  });
});

describe('UPSERT snapshot writers', () => {
  it('writes a project snapshot with explicit options', async () => {
    const { transaction, syncChange } = createFullTransaction();

    await writeProjectUpsert(transaction, PROJECT_ID, {
      targetUserId: 'viewer',
      syncStatus: 'CONFLICT',
      changedAt: NOW,
    });

    expect(syncChange.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: PROJECT_ID,
        ownerId: OWNER_ID,
        targetUserId: 'viewer',
        resourceType: 'PROJECT',
        resourceId: PROJECT_ID,
        operation: 'UPSERT',
        revision: 2,
        syncStatus: 'CONFLICT',
        changedAt: NOW,
      }) as Record<string, unknown>,
      select: { id: true },
    });
  });

  it('falls back to row values when project options are omitted', async () => {
    const { transaction, syncChange } = createFullTransaction();

    await writeProjectUpsert(transaction, PROJECT_ID);

    const data = syncChange.create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(data.data.targetUserId).toBeUndefined();
    expect(data.data.syncStatus).toBe('SYNCED');
    expect(data.data.changedAt).toBe(NOW);
  });

  it('writes a scan snapshot', async () => {
    const { transaction, syncChange } = createFullTransaction();

    await writeScanUpsert(transaction, SCAN_ID, { targetUserId: 'viewer' });

    const data = syncChange.create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(data.data.resourceType).toBe('SCAN');
    expect(data.data.targetUserId).toBe('viewer');
  });

  it('writes a note snapshot with default sync status', async () => {
    const { transaction, syncChange } = createFullTransaction();

    await writeNoteUpsert(transaction, NOTE_ID);

    const data = syncChange.create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(data.data.resourceType).toBe('NOTE');
    expect(data.data.syncStatus).toBe('SYNCED');
  });

  it('writes an asset snapshot deriving sync status from asset status', async () => {
    const { transaction, syncChange } = createFullTransaction();

    await writeAssetUpsert(transaction, ASSET_ID);

    const data = syncChange.create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(data.data.resourceType).toBe('SCAN_ASSET');
    expect(data.data.syncStatus).toBe('SYNCED');
  });

  it('writes an access snapshot', async () => {
    const { transaction, syncChange } = createFullTransaction();

    await writeAccessUpsert(transaction, ACCESS_ID, { targetUserId: 'viewer' });

    const data = syncChange.create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(data.data.resourceType).toBe('PROJECT_ACCESS');
    expect(data.data.targetUserId).toBe('viewer');
  });
});

describe('refreshProjectRollup', () => {
  function projectWithAssetStatuses(statuses: Array<string | undefined>) {
    return {
      id: PROJECT_ID,
      ownerId: OWNER_ID,
      owner: { email: 'owner@example.com' },
      name: 'Apartment',
      description: null,
      revision: 2,
      syncStatus: 'SYNCED',
      lastSyncedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
      scans: statuses.map((status) => ({ assets: [{ status }] })),
    };
  }

  it.each([
    ['FAILED', ['FAILED', 'UPLOADED']],
    ['SYNCING', ['UPLOADING', 'UPLOADED']],
    ['PENDING', ['PENDING', 'UPLOADED']],
    ['PENDING', [undefined]],
    ['SYNCED', ['UPLOADED', 'UPLOADED']],
  ])('rolls up to %s when asset statuses are %j', async (expected, statuses) => {
    const { transaction, project } = createFullTransaction();
    project.findUniqueOrThrow.mockResolvedValueOnce(projectWithAssetStatuses(statuses));

    await refreshProjectRollup(transaction, PROJECT_ID, NOW);

    const update = project.update.mock.calls[0]?.[0] as {
      data: { syncStatus: string; lastSyncedAt?: Date };
    };
    expect(update.data.syncStatus).toBe(expected);
    expect(update.data.lastSyncedAt).toBe(expected === 'SYNCED' ? NOW : undefined);
  });
});

describe('refreshScanRollup', () => {
  it('derives PENDING/NONE from a missing model and rolls up the project', async () => {
    const { transaction, scan } = createFullTransaction();
    scan.findUniqueOrThrow.mockResolvedValueOnce({
      ...createScanRow(),
      assets: [],
    });

    const projectId = await refreshScanRollup(transaction, SCAN_ID, NOW);

    expect(projectId).toBe(PROJECT_ID);
    const scanUpdate = scan.update.mock.calls[0]?.[0] as {
      data: { syncStatus: string; assetStatus: string };
    };
    expect(scanUpdate.data.syncStatus).toBe('PENDING');
    expect(scanUpdate.data.assetStatus).toBe('NONE');
  });

  it('derives a real sync/asset status from an uploaded model', async () => {
    const { transaction, scan } = createFullTransaction();
    scan.findUniqueOrThrow.mockResolvedValueOnce({
      ...createScanRow(),
      assets: [{ status: 'UPLOADED' }],
    });

    await refreshScanRollup(transaction, SCAN_ID, NOW);

    const scanUpdate = scan.update.mock.calls[0]?.[0] as {
      data: { syncStatus: string; assetStatus: string };
    };
    expect(scanUpdate.data.syncStatus).toBe('SYNCED');
    expect(scanUpdate.data.assetStatus).toBe('UPLOADED');
  });
});

describe('sync state helpers', () => {
  it('reports no sync state for an empty id list', async () => {
    const { transaction, syncChange } = createFullTransaction();

    await expect(hasProjectSyncState(transaction, [])).resolves.toBe(false);
    expect(syncChange.count).not.toHaveBeenCalled();
  });

  it('reports sync state from the change count', async () => {
    const { transaction, syncChange } = createFullTransaction();
    syncChange.count.mockResolvedValueOnce(3);

    await expect(hasProjectSyncState(transaction, [PROJECT_ID])).resolves.toBe(true);
  });

  it('reports no sync state when the count is zero', async () => {
    const { transaction, syncChange } = createFullTransaction();
    syncChange.count.mockResolvedValueOnce(0);

    await expect(hasProjectSyncState(transaction, [PROJECT_ID])).resolves.toBe(false);
  });

  it('resets sync state for a list of projects', async () => {
    const { transaction, syncConflict, syncChange } = createFullTransaction();

    await resetProjectSyncState(transaction, [PROJECT_ID]);

    expect(syncConflict.deleteMany).toHaveBeenCalledWith({
      where: { projectId: { in: [PROJECT_ID] } },
    });
    expect(syncChange.deleteMany).toHaveBeenCalledWith({
      where: { projectId: { in: [PROJECT_ID] } },
    });
  });

  it('does nothing when resetting an empty project list', async () => {
    const { transaction, syncChange } = createFullTransaction();

    await resetProjectSyncState(transaction, []);

    expect(syncChange.deleteMany).not.toHaveBeenCalled();
  });
});

describe('writeProjectBootstrap', () => {
  it('writes project, scan, asset, and note snapshots for a viewer', async () => {
    const { transaction, project, syncChange } = createFullTransaction();
    project.findUniqueOrThrow.mockResolvedValue({
      ...createProjectRow(),
      scans: [
        {
          id: SCAN_ID,
          notes: [{ id: NOTE_ID }],
          assets: [{ id: ASSET_ID }],
        },
      ],
    });

    await writeProjectBootstrap(transaction, PROJECT_ID, 'viewer', NOW);

    const resources = (
      syncChange.create.mock.calls as Array<[{ data: { resourceType: string } }]>
    ).map((call) => call[0].data.resourceType);
    expect(resources).toEqual(['PROJECT', 'SCAN', 'SCAN_ASSET', 'NOTE']);
  });
});
