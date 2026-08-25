import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectNotFoundError } from '../src/modules/project/project.errors.js';
import {
  NotSharedProjectError,
  SharedProjectNotInListError,
} from '../src/modules/shared-projects/shared-projects.errors.js';
import {
  sharedProjectStatus,
  SharedProjectsService,
} from '../src/modules/shared-projects/shared-projects.service.js';
import type {
  SharedProjectDetailRecord,
  SharedProjectsRepository,
} from '../src/modules/shared-projects/shared-projects.types.js';

const USER_ID = 'f1a2b3c4-d5e6-7890-abcd-ef1234567890';
const OWNER_ID = 'eb5d278f-c857-45c7-887d-7be65288cb75';
const PROJECT_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const NOW = new Date('2026-07-29T10:00:00.000Z');

function createRecord(
  overrides: Partial<SharedProjectDetailRecord> = {},
): SharedProjectDetailRecord {
  return {
    id: PROJECT_ID,
    name: 'District 2 Apartment',
    description: null,
    owner: { id: OWNER_ID, email: 'owner@example.com', displayName: null },
    scanCount: 2,
    thumbnail: null,
    updatedAt: NOW,
    projectDeletedAt: null,
    accessRevokedAt: null,
    accessDeletedAt: null,
    scans: [],
    ...overrides,
  };
}

function createRepository(): {
  repository: SharedProjectsRepository;
  list: ReturnType<typeof vi.fn>;
  findSharedForUser: ReturnType<typeof vi.fn>;
  findAccessStatus: ReturnType<typeof vi.fn>;
  findProjectOwner: ReturnType<typeof vi.fn>;
  removeFromShared: ReturnType<typeof vi.fn>;
} {
  const list = vi.fn();
  const findSharedForUser = vi.fn();
  const findAccessStatus = vi.fn();
  const findProjectOwner = vi.fn();
  const removeFromShared = vi.fn();

  return {
    repository: {
      list,
      findSharedForUser,
      findAccessStatus,
      findProjectOwner,
      removeFromShared,
    },
    list,
    findSharedForUser,
    findAccessStatus,
    findProjectOwner,
    removeFromShared,
  };
}

describe('sharedProjectStatus', () => {
  it('returns ACTIVE for a live project with active access', () => {
    expect(sharedProjectStatus(createRecord())).toBe('ACTIVE');
  });

  it('returns REVOKED for a live project whose access was revoked', () => {
    expect(sharedProjectStatus(createRecord({ accessRevokedAt: NOW }))).toBe('REVOKED');
  });

  it('returns PROJECT_DELETED for a deleted project whose access was revoked', () => {
    expect(sharedProjectStatus(createRecord({ projectDeletedAt: NOW, accessRevokedAt: NOW }))).toBe(
      'PROJECT_DELETED',
    );
  });

  it('returns TEMPORARILY_UNAVAILABLE for a deleted project with still-active access', () => {
    expect(sharedProjectStatus(createRecord({ projectDeletedAt: NOW }))).toBe(
      'TEMPORARILY_UNAVAILABLE',
    );
  });
});

describe('SharedProjectsService', () => {
  let repository: ReturnType<typeof createRepository>['repository'];
  let list: ReturnType<typeof createRepository>['list'];
  let findSharedForUser: ReturnType<typeof createRepository>['findSharedForUser'];
  let findAccessStatus: ReturnType<typeof createRepository>['findAccessStatus'];
  let findProjectOwner: ReturnType<typeof createRepository>['findProjectOwner'];
  let removeFromShared: ReturnType<typeof createRepository>['removeFromShared'];
  let service: SharedProjectsService;

  beforeEach(() => {
    const created = createRepository();
    repository = created.repository;
    list = created.list;
    findSharedForUser = created.findSharedForUser;
    findAccessStatus = created.findAccessStatus;
    findProjectOwner = created.findProjectOwner;
    removeFromShared = created.removeFromShared;
    service = new SharedProjectsService({ repository, clock: () => NOW });
  });

  describe('list', () => {
    it('maps shared projects to read-only results with status and pagination', async () => {
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
            id: PROJECT_ID,
            name: 'District 2 Apartment',
            description: null,
            owner: { id: OWNER_ID, email: 'owner@example.com', displayName: null },
            scanCount: 2,
            thumbnail: null,
            updatedAt: NOW.toISOString(),
            status: 'ACTIVE',
            permissions: {
              role: 'VIEWER',
              canView: true,
              canEdit: false,
              canDelete: false,
              canShare: false,
              canCreateScan: false,
            },
          },
          {
            id: PROJECT_ID,
            name: 'District 2 Apartment',
            description: null,
            owner: { id: OWNER_ID, email: 'owner@example.com', displayName: null },
            scanCount: 2,
            thumbnail: null,
            updatedAt: NOW.toISOString(),
            status: 'REVOKED',
            permissions: {
              role: 'VIEWER',
              canView: false,
              canEdit: false,
              canDelete: false,
              canShare: false,
              canCreateScan: false,
            },
          },
        ],
        pagination: { page: 1, limit: 5, total: 2, totalPages: 1 },
      });
    });

    it('forwards the search option', async () => {
      list.mockResolvedValue({ items: [], total: 0 });

      await service.list(USER_ID, { search: 'garden', page: 2, limit: 10, sort: 'name:asc' });

      expect(list).toHaveBeenCalledWith(USER_ID, {
        search: 'garden',
        page: 2,
        limit: 10,
        sort: 'name:asc',
      });
    });
  });

  describe('detail', () => {
    it('returns an active shared project with its scans', async () => {
      findSharedForUser.mockResolvedValue(
        createRecord({
          scans: [
            {
              id: 'f1e2d3c4-a5b6-7890-abcd-ef1234567890',
              name: 'Living Room',
              description: null,
              thumbnail: null,
              noteCount: 3,
              assetStatus: 'UPLOADED',
              syncStatus: 'SYNCED',
              createdAt: NOW,
            },
          ],
        }),
      );

      const result = await service.detail(USER_ID, PROJECT_ID);

      expect(findSharedForUser).toHaveBeenCalledWith(PROJECT_ID, USER_ID);
      expect(result.status).toBe('ACTIVE');
      expect(result.permissions).toEqual({
        role: 'VIEWER',
        canView: true,
        canEdit: false,
        canDelete: false,
        canShare: false,
        canCreateScan: false,
      });
      expect(result.scans).toEqual([
        {
          id: 'f1e2d3c4-a5b6-7890-abcd-ef1234567890',
          name: 'Living Room',
          description: null,
          thumbnail: null,
          noteCount: 3,
          assetStatus: 'UPLOADED',
          syncStatus: 'SYNCED',
          createdAt: NOW.toISOString(),
        },
      ]);
    });

    it('hides a project the user has no access to', async () => {
      findSharedForUser.mockResolvedValue(null);

      await expect(service.detail(USER_ID, PROJECT_ID)).rejects.toBeInstanceOf(
        ProjectNotFoundError,
      );
    });

    it('hides a revoked shared project', async () => {
      findSharedForUser.mockResolvedValue(createRecord({ accessRevokedAt: NOW }));

      await expect(service.detail(USER_ID, PROJECT_ID)).rejects.toBeInstanceOf(
        ProjectNotFoundError,
      );
    });

    it('hides a deleted shared project', async () => {
      findSharedForUser.mockResolvedValue(
        createRecord({ projectDeletedAt: NOW, accessRevokedAt: NOW }),
      );

      await expect(service.detail(USER_ID, PROJECT_ID)).rejects.toBeInstanceOf(
        ProjectNotFoundError,
      );
    });
  });

  describe('remove', () => {
    it('removes the current viewer access and confirms removal', async () => {
      findAccessStatus.mockResolvedValue({ revokedAt: null, deletedAt: null });
      removeFromShared.mockResolvedValue({ removedAt: NOW });

      const result = await service.remove(USER_ID, PROJECT_ID);

      expect(findAccessStatus).toHaveBeenCalledWith(PROJECT_ID, USER_ID);
      expect(removeFromShared).toHaveBeenCalledWith(PROJECT_ID, USER_ID, NOW);
      expect(result).toEqual({ projectId: PROJECT_ID, removedAt: NOW.toISOString() });
    });

    it('removes an owner-revoked project from the list', async () => {
      findAccessStatus.mockResolvedValue({ revokedAt: NOW, deletedAt: null });
      removeFromShared.mockResolvedValue({ removedAt: NOW });

      const result = await service.remove(USER_ID, PROJECT_ID);

      expect(removeFromShared).toHaveBeenCalledWith(PROJECT_ID, USER_ID, NOW);
      expect(result).toEqual({ projectId: PROJECT_ID, removedAt: NOW.toISOString() });
    });

    it('is idempotent when the project was already removed', async () => {
      findAccessStatus.mockResolvedValue({ revokedAt: null, deletedAt: NOW });

      const result = await service.remove(USER_ID, PROJECT_ID);

      expect(result).toEqual({ projectId: PROJECT_ID, removedAt: NOW.toISOString() });
      expect(removeFromShared).not.toHaveBeenCalled();
    });

    it('rejects the owner, whose projects are never in Shared With Me', async () => {
      findAccessStatus.mockResolvedValue(null);
      findProjectOwner.mockResolvedValue(USER_ID);

      await expect(service.remove(USER_ID, PROJECT_ID)).rejects.toBeInstanceOf(
        NotSharedProjectError,
      );
      expect(removeFromShared).not.toHaveBeenCalled();
    });

    it('rejects a viewer with no access record', async () => {
      findAccessStatus.mockResolvedValue(null);
      findProjectOwner.mockResolvedValue(OWNER_ID);

      await expect(service.remove(USER_ID, PROJECT_ID)).rejects.toBeInstanceOf(
        SharedProjectNotInListError,
      );
    });

    it('rejects when the concurrent update fails', async () => {
      findAccessStatus.mockResolvedValue({ revokedAt: null, deletedAt: null });
      removeFromShared.mockResolvedValue(null);

      await expect(service.remove(USER_ID, PROJECT_ID)).rejects.toBeInstanceOf(
        SharedProjectNotInListError,
      );
    });
  });
});
