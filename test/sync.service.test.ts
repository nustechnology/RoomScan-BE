import { describe, expect, it, vi } from 'vitest';

import { InvalidCursorError, SyncProjectNotFoundError } from '../src/modules/sync/sync.errors.js';
import { SyncService } from '../src/modules/sync/sync.service.js';
import { encodeSyncCursor } from '../src/modules/sync/sync-cursor.js';
import type {
  SyncChange,
  SyncProjectStatusRecord,
  SyncRepository,
} from '../src/modules/sync/sync.types.js';

const USER_ID = 'eb5d278f-c857-45c7-887d-7be65288cb75';
const PROJECT_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const NOW = new Date('2026-07-29T10:00:00.000Z');

function change(overrides: Partial<SyncChange> = {}): SyncChange {
  return {
    resourceType: 'project',
    resourceId: PROJECT_ID,
    operation: 'CREATE',
    revision: 1,
    syncStatus: null,
    changedAt: NOW,
    deletedAt: null,
    cursor: encodeSyncCursor(NOW, PROJECT_ID),
    ...overrides,
  };
}

function statusRecord(overrides: Partial<SyncProjectStatusRecord> = {}): SyncProjectStatusRecord {
  return {
    projectId: PROJECT_ID,
    syncStatus: 'SYNCED',
    pendingCount: 0,
    syncingCount: 0,
    failedCount: 0,
    conflictCount: 0,
    lastSyncedAt: NOW,
    requiredAssetsUploaded: true,
    ...overrides,
  };
}

function createRepository() {
  return {
    listChanges: vi.fn<SyncRepository['listChanges']>(),
    listProjectStatuses: vi.fn<SyncRepository['listProjectStatuses']>(),
    findProjectStatus: vi.fn<SyncRepository['findProjectStatus']>(),
  };
}

describe('SyncService', () => {
  it('maps repository changes to the serialized result with a next cursor when more exist', async () => {
    const repository = createRepository();
    const first = change({ changedAt: NOW });
    const second = change({
      resourceType: 'scan',
      resourceId: 'f1e2d3c4-a5b6-7890-abcd-ef1234567890',
      operation: 'DELETE',
      revision: 3,
      syncStatus: 'SYNCED',
      deletedAt: NOW,
    });
    repository.listChanges.mockResolvedValue({ changes: [first, second], hasMore: true });
    const service = new SyncService({ repository });

    const result = await service.listChanges(USER_ID, { limit: 2 });

    expect(result.changes).toEqual([
      expect.objectContaining({
        resourceType: 'project',
        resourceId: PROJECT_ID,
        operation: 'CREATE',
        revision: 1,
        syncStatus: null,
        changedAt: NOW.toISOString(),
        deletedAt: null,
      }),
      expect.objectContaining({
        resourceType: 'scan',
        operation: 'DELETE',
        revision: 3,
        syncStatus: 'SYNCED',
        deletedAt: NOW.toISOString(),
      }),
    ]);
    expect(result.nextCursor).toBe(second.cursor);
  });

  it('returns a null next cursor when no further changes exist', async () => {
    const repository = createRepository();
    repository.listChanges.mockResolvedValue({ changes: [change()], hasMore: false });
    const service = new SyncService({ repository });

    const result = await service.listChanges(USER_ID, { limit: 2 });

    expect(result.nextCursor).toBeNull();
  });

  it('forwards since, cursor, and limit to the repository', async () => {
    const repository = createRepository();
    const cursor = encodeSyncCursor(NOW, PROJECT_ID);
    repository.listChanges.mockResolvedValue({ changes: [], hasMore: false });
    const service = new SyncService({ repository });

    await service.listChanges(USER_ID, { since: NOW, limit: 5 });
    expect(repository.listChanges).toHaveBeenCalledWith(USER_ID, { since: NOW, limit: 5 });

    await service.listChanges(USER_ID, { cursor, limit: 5 });
    expect(repository.listChanges).toHaveBeenLastCalledWith(USER_ID, { cursor, limit: 5 });
  });

  it('rejects a malformed cursor before querying', async () => {
    const repository = createRepository();
    const service = new SyncService({ repository });

    await expect(
      service.listChanges(USER_ID, { cursor: 'not-a-valid-cursor!!', limit: 5 }),
    ).rejects.toBeInstanceOf(InvalidCursorError);
    expect(repository.listChanges).not.toHaveBeenCalled();
  });

  it('lists project statuses for the current user', async () => {
    const repository = createRepository();
    repository.listProjectStatuses.mockResolvedValue([statusRecord()]);
    const service = new SyncService({ repository });

    const result = await service.listStatus(USER_ID);

    expect(result).toEqual([
      expect.objectContaining({
        projectId: PROJECT_ID,
        syncStatus: 'SYNCED',
        lastSyncedAt: NOW.toISOString(),
        requiredAssetsUploaded: true,
      }),
    ]);
    expect(repository.listProjectStatuses).toHaveBeenCalledWith(USER_ID);
  });

  it('returns a single project status for the current user', async () => {
    const repository = createRepository();
    repository.findProjectStatus.mockResolvedValue(statusRecord());
    const service = new SyncService({ repository });

    const result = await service.getProjectStatus(USER_ID, PROJECT_ID);

    expect(result.projectId).toBe(PROJECT_ID);
    expect(repository.findProjectStatus).toHaveBeenCalledWith(USER_ID, PROJECT_ID);
  });

  it('throws a not-found error when the project is inaccessible', async () => {
    const repository = createRepository();
    repository.findProjectStatus.mockResolvedValue(null);
    const service = new SyncService({ repository });

    await expect(service.getProjectStatus(USER_ID, PROJECT_ID)).rejects.toBeInstanceOf(
      SyncProjectNotFoundError,
    );
  });
});
