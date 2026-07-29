import { describe, expect, it, vi } from 'vitest';

import { ProjectNotFoundError } from '../src/modules/project/project.errors.js';
import { ProjectPermissionService } from '../src/modules/project/project.permissions.js';
import { ProjectService } from '../src/modules/project/project.service.js';
import type { ProjectRecord, ProjectRepository } from '../src/modules/project/project.types.js';

const OWNER_ID = 'eb5d278f-c857-45c7-887d-7be65288cb75';
const VIEWER_ID = '8c53d31d-2788-48de-82a0-c4f219ca3701';
const PROJECT_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const NOW = new Date('2026-07-29T10:00:00.000Z');

function createRecord(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: PROJECT_ID,
    name: 'Apartment scan',
    description: 'First floor',
    ownerId: OWNER_ID,
    owner: {
      id: OWNER_ID,
      email: 'owner@example.com',
    },
    scanCount: 0,
    sharedCount: 1,
    thumbnail: null,
    syncStatus: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function createRepository() {
  const mocks = {
    create: vi.fn<ProjectRepository['create']>().mockResolvedValue(createRecord()),
    list: vi
      .fn<ProjectRepository['list']>()
      .mockResolvedValue({ items: [createRecord()], total: 1 }),
    findById: vi.fn<ProjectRepository['findById']>().mockResolvedValue(createRecord()),
    findAccessRole: vi
      .fn<ProjectRepository['findAccessRole']>()
      .mockImplementation(async (_projectId, userId) =>
        Promise.resolve(userId === OWNER_ID ? 'OWNER' : userId === VIEWER_ID ? 'VIEWER' : null),
      ),
    update: vi.fn<ProjectRepository['update']>().mockResolvedValue(createRecord()),
    softDelete: vi.fn<ProjectRepository['softDelete']>().mockResolvedValue(undefined),
  };
  const repository: ProjectRepository = mocks;
  const permissions = new ProjectPermissionService(repository);
  const service = new ProjectService({ repository, permissions });

  return { mocks, repository, service };
}

describe('ProjectService', () => {
  it('creates a project with Owner permissions', async () => {
    const { mocks, service } = createRepository();

    await expect(
      service.create(OWNER_ID, { name: 'Apartment scan', description: 'First floor' }),
    ).resolves.toEqual({
      id: PROJECT_ID,
      name: 'Apartment scan',
      description: 'First floor',
      owner: {
        id: OWNER_ID,
        email: 'owner@example.com',
      },
      scanCount: 0,
      sharedCount: 1,
      thumbnail: null,
      syncStatus: null,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      permissions: {
        role: 'OWNER',
        canView: true,
        canEdit: true,
        canDelete: true,
        canShare: true,
        canCreateScan: true,
      },
    });
    expect(mocks.create).toHaveBeenCalledWith(OWNER_ID, {
      name: 'Apartment scan',
      description: 'First floor',
    });
  });

  it('lists owned projects with page-based pagination', async () => {
    const { mocks, service } = createRepository();
    mocks.list.mockResolvedValue({
      items: [createRecord(), createRecord({ id: 'b2c3d4e5-f6a7-4901-bcde-f12345678901' })],
      total: 7,
    });
    const options = {
      search: 'apartment',
      page: 2,
      limit: 3,
      sort: 'name:asc' as const,
    };

    const result = await service.list(OWNER_ID, options);

    expect(mocks.list).toHaveBeenCalledWith(OWNER_ID, options);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.permissions.role).toBe('OWNER');
    expect(result.pagination).toEqual({
      page: 2,
      limit: 3,
      total: 7,
      totalPages: 3,
    });
  });

  it('returns zero total pages for an empty list', async () => {
    const { mocks, service } = createRepository();
    mocks.list.mockResolvedValue({ items: [], total: 0 });

    const result = await service.list(OWNER_ID, {
      page: 1,
      limit: 5,
      sort: 'updatedAt:desc',
    });

    expect(result.pagination.totalPages).toBe(0);
  });

  it('returns Owner permissions for project detail', async () => {
    const { mocks, service } = createRepository();

    const result = await service.getById(OWNER_ID, PROJECT_ID);

    expect(mocks.findAccessRole).toHaveBeenCalledWith(PROJECT_ID, OWNER_ID);
    expect(mocks.findById).toHaveBeenCalledWith(PROJECT_ID);
    expect(result.permissions).toMatchObject({
      role: 'OWNER',
      canView: true,
      canEdit: true,
      canDelete: true,
    });
  });

  it('returns read-only permissions for an active Viewer', async () => {
    const { service } = createRepository();

    const result = await service.getById(VIEWER_ID, PROJECT_ID);

    expect(result.permissions).toEqual({
      role: 'VIEWER',
      canView: true,
      canEdit: false,
      canDelete: false,
      canShare: false,
      canCreateScan: false,
    });
  });

  it('hides a missing, deleted, revoked, or inaccessible project', async () => {
    const { mocks, service } = createRepository();
    mocks.findAccessRole.mockResolvedValue(null);

    await expect(service.getById(VIEWER_ID, PROJECT_ID)).rejects.toBeInstanceOf(
      ProjectNotFoundError,
    );
    expect(mocks.findById).toHaveBeenCalledWith(PROJECT_ID);
  });

  it('hides a missing project before checking access', async () => {
    const { mocks, service } = createRepository();
    mocks.findById.mockResolvedValue(null);

    await expect(service.getById(OWNER_ID, PROJECT_ID)).rejects.toBeInstanceOf(
      ProjectNotFoundError,
    );
    expect(mocks.findAccessRole).not.toHaveBeenCalled();
  });

  it('updates a project as its Owner', async () => {
    const { mocks, service } = createRepository();

    const result = await service.update(OWNER_ID, PROJECT_ID, {
      name: 'Updated name',
      description: null,
    });

    expect(mocks.findAccessRole).toHaveBeenCalledWith(PROJECT_ID, OWNER_ID);
    expect(mocks.update).toHaveBeenCalledWith(PROJECT_ID, OWNER_ID, {
      name: 'Updated name',
      description: null,
    });
    expect(result.permissions.role).toBe('OWNER');
  });

  it('hides update from a Viewer', async () => {
    const { mocks, service } = createRepository();

    await expect(
      service.update(VIEWER_ID, PROJECT_ID, { name: 'Forbidden change' }),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('soft-deletes a project and preserves repository idempotency', async () => {
    const { mocks, service } = createRepository();

    await service.delete(OWNER_ID, PROJECT_ID);

    expect(mocks.softDelete).toHaveBeenCalledWith(PROJECT_ID, OWNER_ID);
  });

  it('propagates the hidden not-found error for unauthorized deletion', async () => {
    const { mocks, service } = createRepository();
    mocks.softDelete.mockRejectedValue(new ProjectNotFoundError());

    await expect(service.delete(VIEWER_ID, PROJECT_ID)).rejects.toBeInstanceOf(
      ProjectNotFoundError,
    );
  });
});
