import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ScanNotFoundError } from '../src/modules/scan/scan.errors.js';
import {
  NotSharedScanError,
  SharedScanNotInListError,
} from '../src/modules/shared-scans/shared-scans.errors.js';
import {
  sharedScanStatus,
  SharedScansService,
} from '../src/modules/shared-scans/shared-scans.service.js';
import type {
  SharedScanRecord,
  SharedScansRepository,
} from '../src/modules/shared-scans/shared-scans.types.js';

const USER_ID = 'f1a2b3c4-d5e6-7890-abcd-ef1234567890';
const OWNER_ID = 'eb5d278f-c857-45c7-887d-7be65288cb75';
const SCAN_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const PROJECT_ID = '11111111-2222-4333-8444-555555555555';
const NOW = new Date('2026-07-29T10:00:00.000Z');

function createRecord(overrides: Partial<SharedScanRecord> = {}): SharedScanRecord {
  return {
    id: SCAN_ID,
    projectId: PROJECT_ID,
    name: 'Living Room Scan',
    description: null,
    thumbnail: null,
    creator: { id: OWNER_ID, email: 'owner@example.com' },
    noteCount: 2,
    assetStatus: 'UPLOADED',
    syncStatus: 'SYNCED',
    modelVersion: 1,
    updatedAt: NOW,
    scanDeletedAt: null,
    accessRevokedAt: null,
    accessDeletedAt: null,
    ...overrides,
  };
}

function createRepository(): {
  repository: SharedScansRepository;
  list: ReturnType<typeof vi.fn>;
  findSharedForUser: ReturnType<typeof vi.fn>;
  findAccessStatus: ReturnType<typeof vi.fn>;
  findScanOwner: ReturnType<typeof vi.fn>;
  removeFromShared: ReturnType<typeof vi.fn>;
} {
  const list = vi.fn();
  const findSharedForUser = vi.fn();
  const findAccessStatus = vi.fn();
  const findScanOwner = vi.fn();
  const removeFromShared = vi.fn();

  return {
    repository: {
      list,
      findSharedForUser,
      findAccessStatus,
      findScanOwner,
      removeFromShared,
    },
    list,
    findSharedForUser,
    findAccessStatus,
    findScanOwner,
    removeFromShared,
  };
}

describe('sharedScanStatus', () => {
  it('returns ACTIVE for a live scan with active access', () => {
    expect(sharedScanStatus(createRecord())).toBe('ACTIVE');
  });

  it('returns REVOKED for a live scan whose access was revoked', () => {
    expect(sharedScanStatus(createRecord({ accessRevokedAt: NOW }))).toBe('REVOKED');
  });

  it('returns SCAN_DELETED for a deleted scan whose access was revoked', () => {
    expect(sharedScanStatus(createRecord({ scanDeletedAt: NOW, accessRevokedAt: NOW }))).toBe(
      'SCAN_DELETED',
    );
  });

  it('returns TEMPORARILY_UNAVAILABLE for a deleted scan with still-active access', () => {
    expect(sharedScanStatus(createRecord({ scanDeletedAt: NOW }))).toBe('TEMPORARILY_UNAVAILABLE');
  });
});

describe('SharedScansService', () => {
  let repository: ReturnType<typeof createRepository>['repository'];
  let list: ReturnType<typeof createRepository>['list'];
  let findSharedForUser: ReturnType<typeof createRepository>['findSharedForUser'];
  let findAccessStatus: ReturnType<typeof createRepository>['findAccessStatus'];
  let findScanOwner: ReturnType<typeof createRepository>['findScanOwner'];
  let removeFromShared: ReturnType<typeof createRepository>['removeFromShared'];
  let service: SharedScansService;

  beforeEach(() => {
    const created = createRepository();
    repository = created.repository;
    list = created.list;
    findSharedForUser = created.findSharedForUser;
    findAccessStatus = created.findAccessStatus;
    findScanOwner = created.findScanOwner;
    removeFromShared = created.removeFromShared;
    service = new SharedScansService({ repository, clock: () => NOW });
  });

  describe('list', () => {
    it('maps shared scans to read-only results with status and pagination', async () => {
      list.mockResolvedValue({
        items: [createRecord(), createRecord({ accessRevokedAt: NOW })],
        total: 2,
      });

      const result = await service.list(USER_ID, {
        page: 1,
        limit: 5,
        sort: 'updatedAt:desc',
      });

      expect(list).toHaveBeenCalledWith(USER_ID, {
        page: 1,
        limit: 5,
        sort: 'updatedAt:desc',
      });
      expect(result).toEqual({
        items: [
          {
            id: SCAN_ID,
            projectId: PROJECT_ID,
            name: 'Living Room Scan',
            description: null,
            thumbnail: null,
            creator: { id: OWNER_ID, email: 'owner@example.com' },
            noteCount: 2,
            assetStatus: 'UPLOADED',
            syncStatus: 'SYNCED',
            modelVersion: 1,
            updatedAt: NOW.toISOString(),
            status: 'ACTIVE',
            permissions: { role: 'VIEWER', canView: true, canEdit: false, canDelete: false },
          },
          {
            id: SCAN_ID,
            projectId: PROJECT_ID,
            name: 'Living Room Scan',
            description: null,
            thumbnail: null,
            creator: { id: OWNER_ID, email: 'owner@example.com' },
            noteCount: 2,
            assetStatus: 'UPLOADED',
            syncStatus: 'SYNCED',
            modelVersion: 1,
            updatedAt: NOW.toISOString(),
            status: 'REVOKED',
            permissions: { role: 'VIEWER', canView: false, canEdit: false, canDelete: false },
          },
        ],
        pagination: { page: 1, limit: 5, total: 2, totalPages: 1 },
      });
    });

    it('forwards the search option', async () => {
      list.mockResolvedValue({ items: [], total: 0 });

      await service.list(USER_ID, { search: 'living', page: 2, limit: 10, sort: 'name:asc' });

      expect(list).toHaveBeenCalledWith(USER_ID, {
        search: 'living',
        page: 2,
        limit: 10,
        sort: 'name:asc',
      });
    });
  });

  describe('detail', () => {
    it('returns an active shared scan', async () => {
      findSharedForUser.mockResolvedValue(createRecord());

      const result = await service.detail(USER_ID, SCAN_ID);

      expect(findSharedForUser).toHaveBeenCalledWith(SCAN_ID, USER_ID);
      expect(result.status).toBe('ACTIVE');
      expect(result.permissions).toEqual({
        role: 'VIEWER',
        canView: true,
        canEdit: false,
        canDelete: false,
      });
    });

    it('hides a scan the user has no access to', async () => {
      findSharedForUser.mockResolvedValue(null);

      await expect(service.detail(USER_ID, SCAN_ID)).rejects.toBeInstanceOf(ScanNotFoundError);
    });

    it('hides a revoked shared scan', async () => {
      findSharedForUser.mockResolvedValue(createRecord({ accessRevokedAt: NOW }));

      await expect(service.detail(USER_ID, SCAN_ID)).rejects.toBeInstanceOf(ScanNotFoundError);
    });

    it('hides a deleted shared scan', async () => {
      findSharedForUser.mockResolvedValue(
        createRecord({ scanDeletedAt: NOW, accessRevokedAt: NOW }),
      );

      await expect(service.detail(USER_ID, SCAN_ID)).rejects.toBeInstanceOf(ScanNotFoundError);
    });
  });

  describe('remove', () => {
    it('removes the current viewer access and confirms removal', async () => {
      findAccessStatus.mockResolvedValue({ revokedAt: null, deletedAt: null });
      removeFromShared.mockResolvedValue(true);

      const result = await service.remove(USER_ID, SCAN_ID);

      expect(findAccessStatus).toHaveBeenCalledWith(SCAN_ID, USER_ID);
      expect(removeFromShared).toHaveBeenCalledWith(SCAN_ID, USER_ID, NOW);
      expect(result).toEqual({ scanId: SCAN_ID, removedAt: NOW.toISOString() });
    });

    it('removes an owner-revoked scan from the list', async () => {
      findAccessStatus.mockResolvedValue({ revokedAt: NOW, deletedAt: null });
      removeFromShared.mockResolvedValue(true);

      const result = await service.remove(USER_ID, SCAN_ID);

      expect(removeFromShared).toHaveBeenCalledWith(SCAN_ID, USER_ID, NOW);
      expect(result).toEqual({ scanId: SCAN_ID, removedAt: NOW.toISOString() });
    });

    it('is idempotent when the scan was already removed', async () => {
      findAccessStatus.mockResolvedValue({ revokedAt: null, deletedAt: NOW });

      const result = await service.remove(USER_ID, SCAN_ID);

      expect(result).toEqual({ scanId: SCAN_ID, removedAt: NOW.toISOString() });
      expect(removeFromShared).not.toHaveBeenCalled();
    });

    it('rejects the owner, whose scans are never in Shared With Me', async () => {
      findAccessStatus.mockResolvedValue(null);
      findScanOwner.mockResolvedValue(USER_ID);

      await expect(service.remove(USER_ID, SCAN_ID)).rejects.toBeInstanceOf(NotSharedScanError);
      expect(removeFromShared).not.toHaveBeenCalled();
    });

    it('rejects a viewer with no access record', async () => {
      findAccessStatus.mockResolvedValue(null);
      findScanOwner.mockResolvedValue(OWNER_ID);

      await expect(service.remove(USER_ID, SCAN_ID)).rejects.toBeInstanceOf(
        SharedScanNotInListError,
      );
    });

    it('rejects when the concurrent update fails', async () => {
      findAccessStatus.mockResolvedValue({ revokedAt: null, deletedAt: null });
      removeFromShared.mockResolvedValue(false);

      await expect(service.remove(USER_ID, SCAN_ID)).rejects.toBeInstanceOf(
        SharedScanNotInListError,
      );
    });
  });
});
