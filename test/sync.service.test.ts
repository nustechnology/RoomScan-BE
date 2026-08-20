import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SyncCrypto } from '../src/infrastructure/crypto/sync-crypto.js';
import { ProjectNotFoundError } from '../src/modules/project/project.errors.js';
import {
  InvalidSyncCursorError,
  InvalidSyncTimestampError,
} from '../src/modules/sync/sync.errors.js';
import { SyncChangesResponseSchema } from '../src/modules/sync/sync.schemas.js';
import { SyncService } from '../src/modules/sync/sync.service.js';
import type { SyncChangeRecord, SyncRepository } from '../src/modules/sync/sync.types.js';

const USER_ID = 'eb5d278f-c857-45c7-887d-7be65288cb75';
const OTHER_USER_ID = '8c53d31d-2788-48de-82a0-c4f219ca3701';
const PROJECT_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const SCAN_ID = 'f1e2d3c4-a5b6-7890-abcd-ef1234567890';
const NOW = new Date('2026-08-17T04:00:00.000Z');

function change(overrides: Partial<SyncChangeRecord> = {}): SyncChangeRecord {
  return {
    sequence: 10n,
    resourceType: 'PROJECT',
    resourceId: PROJECT_ID,
    operation: 'UPSERT',
    revision: 2,
    syncStatus: 'SYNCED',
    changedAt: NOW,
    deletedAt: null,
    data: { id: PROJECT_ID, name: 'Room' },
    ...overrides,
  };
}

describe('SyncService', () => {
  const repository = {
    getWatermark: vi.fn<SyncRepository['getWatermark']>(),
    listSnapshot: vi.fn<SyncRepository['listSnapshot']>(),
    listIncremental: vi.fn<SyncRepository['listIncremental']>(),
    acknowledge: vi.fn<SyncRepository['acknowledge']>(),
    listStatuses: vi.fn<SyncRepository['listStatuses']>(),
  };
  const crypto = new SyncCrypto(Buffer.alloc(32, 11).toString('base64'));
  const service = new SyncService({ repository, crypto, clock: () => NOW });

  beforeEach(() => {
    vi.clearAllMocks();
    repository.getWatermark.mockResolvedValue(20n);
    repository.listSnapshot.mockResolvedValue({ items: [], hasMore: false });
    repository.listIncremental.mockResolvedValue({ items: [] });
    repository.acknowledge.mockResolvedValue();
    repository.listStatuses.mockResolvedValue([]);
  });

  it('paginates a stable initial snapshot at one watermark', async () => {
    repository.listSnapshot
      .mockResolvedValueOnce({
        items: [change(), change({ resourceType: 'SCAN', resourceId: SCAN_ID, sequence: 12n })],
        hasMore: true,
      })
      .mockResolvedValueOnce({ items: [], hasMore: false });

    const first = await service.getChanges(USER_ID, { limit: 2 });

    expect(repository.getWatermark).toHaveBeenCalledOnce();
    expect(repository.listSnapshot).toHaveBeenCalledWith(USER_ID, 20n, null, 2);
    expect(first.changes).toEqual([
      expect.objectContaining({
        resourceType: 'PROJECT',
        resourceId: PROJECT_ID,
        revision: 2,
        changedAt: NOW.toISOString(),
        deletedAt: null,
      }),
      expect.objectContaining({ resourceType: 'SCAN', resourceId: SCAN_ID }),
    ]);

    const second = await service.getChanges(USER_ID, { cursor: first.nextCursor, limit: 2 });
    expect(repository.getWatermark).toHaveBeenCalledOnce();
    expect(repository.listSnapshot).toHaveBeenLastCalledWith(
      USER_ID,
      20n,
      { resourceType: 'SCAN', resourceId: SCAN_ID },
      2,
    );
    expect(second.changes).toEqual([]);

    await service.getChanges(USER_ID, { cursor: second.nextCursor, limit: 2 });
    expect(repository.acknowledge).toHaveBeenCalledWith(USER_ID, 20n, NOW);
  });

  it('returns incremental events in repository order and advances from each event sequence', async () => {
    repository.getWatermark.mockResolvedValueOnce(30n);
    repository.listIncremental.mockResolvedValueOnce({
      items: [
        change({ sequence: 21n }),
        change({
          sequence: 22n,
          resourceType: 'NOTE',
          resourceId: SCAN_ID,
          operation: 'DELETE',
          data: null,
          deletedAt: NOW,
        }),
      ],
    });
    const cursor = crypto.signCursor({
      v: 1,
      mode: 'incremental',
      userId: USER_ID,
      after: '20',
    });

    const result = await service.getChanges(USER_ID, { cursor, limit: 100 });

    expect(repository.acknowledge).toHaveBeenCalledWith(USER_ID, 20n, NOW);
    expect(repository.listIncremental).toHaveBeenCalledWith(USER_ID, 20n, 30n, null, 100);
    expect(result.changes.map((item) => item.operation)).toEqual(['UPSERT', 'DELETE']);
    expect(result.changes[1]).toMatchObject({ data: null, deletedAt: NOW.toISOString() });
    expect(crypto.verifyCursor(result.nextCursor)).toMatchObject({
      mode: 'incremental',
      after: '22',
      userId: USER_ID,
    });
  });

  it('uses an RFC3339 timestamp inclusively and returns an incremental cursor', async () => {
    const result = await service.getChanges(USER_ID, {
      since: '2026-08-17T04:00:00+00:00',
      limit: 50,
    });

    expect(repository.listIncremental).toHaveBeenCalledWith(USER_ID, 0n, 20n, NOW, 50);
    expect(crypto.verifyCursor(result.nextCursor)).toMatchObject({
      mode: 'incremental',
      after: '20',
      since: NOW.toISOString(),
    });

    await service.getChanges(USER_ID, { cursor: result.nextCursor, limit: 25 });
    expect(repository.listIncremental).toHaveBeenLastCalledWith(USER_ID, 20n, 20n, NOW, 25);
  });

  it('rejects invalid timestamps and ambiguous, malformed, tampered, or cross-user cursors', async () => {
    await expect(
      service.getChanges(USER_ID, { since: '2026-08-17', limit: 10 }),
    ).rejects.toBeInstanceOf(InvalidSyncTimestampError);
    await expect(
      service.getChanges(USER_ID, { since: NOW.toISOString(), cursor: 'anything', limit: 10 }),
    ).rejects.toBeInstanceOf(InvalidSyncCursorError);
    await expect(
      service.getChanges(USER_ID, { cursor: 'malformed', limit: 10 }),
    ).rejects.toBeInstanceOf(InvalidSyncCursorError);

    const valid = crypto.signCursor({
      v: 1,
      mode: 'incremental',
      userId: USER_ID,
      after: '10',
    });
    await expect(
      service.getChanges(USER_ID, { cursor: `${valid.slice(0, -1)}x`, limit: 10 }),
    ).rejects.toBeInstanceOf(InvalidSyncCursorError);
    await expect(
      service.getChanges(OTHER_USER_ID, { cursor: valid, limit: 10 }),
    ).rejects.toBeInstanceOf(InvalidSyncCursorError);

    const incompleteSnapshot = crypto.signCursor({
      v: 1,
      mode: 'snapshot',
      userId: USER_ID,
      watermark: '20',
      afterType: 'PROJECT',
    });
    await expect(
      service.getChanges(USER_ID, { cursor: incompleteSnapshot, limit: 10 }),
    ).rejects.toBeInstanceOf(InvalidSyncCursorError);
  });

  it('returns accessible statuses and hides an inaccessible requested project as not found', async () => {
    repository.listStatuses.mockResolvedValueOnce([
      {
        projectId: PROJECT_ID,
        syncStatus: 'SYNCED',
        pendingCount: 0,
        syncingCount: 0,
        failedCount: 0,
        conflictCount: 0,
        lastSyncedAt: NOW.toISOString(),
        requiredAssetsUploaded: true,
      },
    ]);
    await expect(service.getStatus(USER_ID)).resolves.toMatchObject({
      items: [expect.objectContaining({ projectId: PROJECT_ID, syncStatus: 'SYNCED' })],
    });

    repository.listStatuses.mockResolvedValueOnce([]);
    await expect(service.getStatus(USER_ID, PROJECT_ID)).rejects.toBeInstanceOf(
      ProjectNotFoundError,
    );
  });

  it('accepts CYAN and GRAY notes in the sync changes response schema', () => {
    const base = {
      resourceId: SCAN_ID,
      operation: 'UPSERT',
      revision: 2,
      syncStatus: 'SYNCED',
      changedAt: NOW.toISOString(),
      cursor: 'opaque',
      deletedAt: null,
    };
    const noteFor = (color: string) => ({
      ...base,
      resourceType: 'NOTE',
      data: {
        id: SCAN_ID,
        scanId: SCAN_ID,
        createdById: USER_ID,
        creatorEmail: null,
        title: 'Hinge',
        content: 'Loose',
        color,
        position: { x: 1, y: 2, z: 3 },
        orientation: null,
        modelVersion: '1',
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
      },
    });

    const parsed = SyncChangesResponseSchema.parse({
      changes: [noteFor('CYAN'), noteFor('GRAY')],
      nextCursor: 'opaque',
    });

    expect(parsed.changes.map((item) => (item as { data: { color: string } }).data.color)).toEqual([
      'CYAN',
      'GRAY',
    ]);
  });
});
