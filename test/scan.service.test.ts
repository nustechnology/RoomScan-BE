import { describe, expect, it, vi } from 'vitest';

import { ScanNotFoundError } from '../src/modules/scan/scan.errors.js';
import type { ProjectRepository } from '../src/modules/project/project.types.js';
import { ProjectPermissionService } from '../src/modules/project/project.permissions.js';
import { ScanService } from '../src/modules/scan/scan.service.js';
import type { ScanRecord, ScanRepository } from '../src/modules/scan/scan.types.js';

const OWNER_ID = 'eb5d278f-c857-45c7-887d-7be65288cb75';
const VIEWER_ID = '8c53d31d-2788-48de-82a0-c4f219ca3701';
const PROJECT_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const SCAN_ID = 'f1e2d3c4-a5b6-7890-abcd-ef1234567890';
const NOW = new Date('2026-07-29T10:00:00.000Z');

function createRecord(overrides: Partial<ScanRecord> = {}): ScanRecord {
  return {
    id: SCAN_ID,
    projectId: PROJECT_ID,
    createdById: OWNER_ID,
    creator: {
      id: OWNER_ID,
      email: 'owner@example.com',
    },
    name: 'Living Room',
    description: null,
    thumbnail: null,
    noteCount: 0,
    assetStatus: 'NONE',
    syncStatus: 'PENDING',
    modelVersion: 1,
    clientMutationId: null,
    deletedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function createRepository() {
  const mocks = {
    create: vi
      .fn<ScanRepository['create']>()
      .mockResolvedValue({ record: createRecord(), created: true }),
    listByProject: vi
      .fn<ScanRepository['listByProject']>()
      .mockResolvedValue({ items: [createRecord()], total: 1 }),
    findProjectId: vi.fn<ScanRepository['findProjectId']>().mockResolvedValue(PROJECT_ID),
    findByIdForUser: vi
      .fn<ScanRepository['findByIdForUser']>()
      .mockResolvedValue({ record: createRecord(), role: 'OWNER' }),
    update: vi.fn<ScanRepository['update']>().mockResolvedValue(createRecord()),
    softDelete: vi.fn<ScanRepository['softDelete']>().mockResolvedValue(undefined),
    updateAssetStatus: vi.fn<ScanRepository['updateAssetStatus']>().mockResolvedValue(undefined),
    updateThumbnail: vi.fn<ScanRepository['updateThumbnail']>().mockResolvedValue(undefined),
  };
  const repository: ScanRepository = mocks;
  const findAccessRole = vi
    .fn<ProjectRepository['findAccessRole']>()
    .mockImplementation(async (_projectId, userId) =>
      Promise.resolve(userId === OWNER_ID ? 'OWNER' : userId === VIEWER_ID ? 'VIEWER' : null),
    );
  const projectRepository = {
    create: vi.fn(),
    list: vi.fn(),
    findByIdForUser: vi.fn(),
    findAccessRole,
    update: vi.fn(),
    softDelete: vi.fn(),
  } as unknown as ProjectRepository;
  const permissions = new ProjectPermissionService(projectRepository);
  const service = new ScanService({ repository, permissions });

  return { mocks, repository, permissions, service, findAccessRole };
}

describe('ScanService', () => {
  it('creates a scan as the Owner', async () => {
    const { mocks, service } = createRepository();

    const result = await service.create(OWNER_ID, PROJECT_ID, {
      name: 'Living Room',
      description: null,
    });

    expect(mocks.create).toHaveBeenCalledWith(PROJECT_ID, OWNER_ID, {
      name: 'Living Room',
      description: null,
    });
    expect(result.created).toBe(true);
    expect(result.scan.name).toBe('Living Room');
    expect(result.scan.permissions.role).toBe('OWNER');
  });

  it('rejects create from a Viewer', async () => {
    const { service } = createRepository();

    await expect(
      service.create(VIEWER_ID, PROJECT_ID, { name: 'Living Room', description: null }),
    ).rejects.toBeInstanceOf(ScanNotFoundError);
  });

  it('returns an existing scan as not-created for an idempotent clientMutationId', async () => {
    const { mocks, service } = createRepository();
    mocks.create.mockResolvedValueOnce({
      record: createRecord({ clientMutationId: 'mutation-abc' }),
      created: false,
    });

    const result = await service.create(OWNER_ID, PROJECT_ID, {
      name: 'Living Room',
      description: null,
      clientMutationId: 'mutation-abc',
    });

    expect(mocks.create).toHaveBeenCalledWith(PROJECT_ID, OWNER_ID, {
      name: 'Living Room',
      description: null,
      clientMutationId: 'mutation-abc',
    });
    expect(result.created).toBe(false);
    expect(result.scan.id).toBe(SCAN_ID);
  });

  it('propagates an existing legacy-key scan as not-created', async () => {
    const { mocks, service } = createRepository();
    mocks.create.mockResolvedValueOnce({
      record: createRecord({ clientMutationId: 'deleted-mutation', name: 'Restored' }),
      created: false,
    });

    const result = await service.create(OWNER_ID, PROJECT_ID, {
      name: 'Restored',
      description: null,
      clientMutationId: 'deleted-mutation',
    });

    expect(result.created).toBe(false);
    expect(result.scan.name).toBe('Restored');
  });

  it('prepares optional uploads only after receipt lookup and delegates one transactional create', async () => {
    const { repository, permissions } = createRepository();
    const context = {
      userId: OWNER_ID,
      operation: 'CREATE_SCAN' as const,
      parentScope: `project:${PROJECT_ID}`,
      keyHash: 'key-hash',
      requestHash: 'request-hash',
    };
    const idempotency = {
      createContext: vi.fn().mockReturnValue(context),
      lookup: vi.fn().mockResolvedValue(null),
      execute: vi.fn(),
    };
    const prepared = [
      {
        data: {
          id: 'c0ffee00-0000-4000-8000-000000000001',
          scanId: SCAN_ID,
          assetType: 'MODEL' as const,
          contentType: 'model/usdz',
          sizeBytes: 20_000_000,
          checksum: 'checksum',
          modelVersion: '1',
          storageKey: `scans/${SCAN_ID}/model`,
          idempotencyKey: null,
          uploadUrlExpiresAt: NOW,
        },
        response: {
          uploadSessionId: 'c0ffee00-0000-4000-8000-000000000001',
          assetId: 'c0ffee00-0000-4000-8000-000000000001',
          uploadUrl: 'https://storage/upload',
          uploadUrlExpiresAt: NOW.toISOString(),
        },
      },
    ];
    const uploadPreparer = {
      prepareScanCreateUploads: vi.fn().mockImplementation((scanId: string) => {
        prepared[0]!.data.scanId = scanId;
        return Promise.resolve(prepared);
      }),
    };
    const createWithUploadsIdempotently = vi
      .fn()
      .mockImplementation(
        (
          _scanId: string,
          _projectId: string,
          _userId: string,
          _data: unknown,
          uploads: typeof prepared,
        ) =>
          Promise.resolve({
            body: {
              ...createRecord(),
              createdAt: NOW.toISOString(),
              updatedAt: NOW.toISOString(),
              permissions: { role: 'OWNER', canView: true, canEdit: true, canDelete: true },
              uploads: { scanFile: uploads[0]!.response },
            },
            statusCode: 201,
            replayed: false,
          }),
      );
    repository.createWithUploadsIdempotently = createWithUploadsIdempotently;
    const service = new ScanService({
      repository,
      permissions,
      idempotency,
      uploadPreparer,
    });
    const descriptor = {
      assetType: 'MODEL' as const,
      contentType: 'model/usdz',
      sizeBytes: 20_000_000,
      checksum: 'checksum',
      modelVersion: '1',
    };

    const result = await service.createWithUploadsIdempotently(
      OWNER_ID,
      PROJECT_ID,
      { name: 'Living Room', description: null },
      [descriptor],
      'retry-key',
      { name: 'Living Room', scanFile: descriptor },
    );

    expect(idempotency.lookup).toHaveBeenCalledWith(context);
    expect(uploadPreparer.prepareScanCreateUploads).toHaveBeenCalledWith(expect.any(String), [
      descriptor,
    ]);
    expect(createWithUploadsIdempotently).toHaveBeenCalledWith(
      expect.any(String),
      PROJECT_ID,
      OWNER_ID,
      { name: 'Living Room', description: null },
      prepared,
      context,
    );
    expect(result.body.uploads?.scanFile?.uploadUrl).toBe('https://storage/upload');
  });

  it('lists active scans for an Owner', async () => {
    const { mocks, service } = createRepository();

    const result = await service.list(OWNER_ID, PROJECT_ID, {
      page: 1,
      limit: 20,
      sort: 'createdAt:desc',
    });

    expect(mocks.listByProject).toHaveBeenCalledWith(PROJECT_ID, {
      page: 1,
      limit: 20,
      sort: 'createdAt:desc',
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.permissions.role).toBe('OWNER');
  });

  it('lists active scans for an active Viewer', async () => {
    const { mocks, service } = createRepository();

    const result = await service.list(VIEWER_ID, PROJECT_ID, {
      page: 1,
      limit: 20,
      sort: 'createdAt:desc',
    });

    expect(mocks.listByProject).toHaveBeenCalledWith(PROJECT_ID, {
      page: 1,
      limit: 20,
      sort: 'createdAt:desc',
    });
    expect(result.items[0]?.permissions.role).toBe('VIEWER');
  });

  it('rejects list when the Viewer has no project access', async () => {
    const { findAccessRole, service } = createRepository();
    findAccessRole.mockResolvedValueOnce(null);

    await expect(
      service.list(VIEWER_ID, PROJECT_ID, {
        page: 1,
        limit: 20,
        sort: 'createdAt:desc',
      }),
    ).rejects.toBeInstanceOf(ScanNotFoundError);
  });

  it('returns scan detail for an Owner', async () => {
    const { mocks, service } = createRepository();

    const result = await service.getById(OWNER_ID, SCAN_ID);

    expect(mocks.findByIdForUser).toHaveBeenCalledWith(SCAN_ID, OWNER_ID);
    expect(result.name).toBe('Living Room');
    expect(result.permissions.role).toBe('OWNER');
  });

  it('returns scan detail for an active Viewer', async () => {
    const { mocks, service } = createRepository();
    mocks.findByIdForUser.mockResolvedValueOnce({
      record: createRecord(),
      role: 'VIEWER',
    });

    const result = await service.getById(VIEWER_ID, SCAN_ID);

    expect(result.permissions.role).toBe('VIEWER');
    expect(result.permissions.canEdit).toBe(false);
    expect(result.permissions.canDelete).toBe(false);
  });

  it('throws hidden not-found for a missing or inaccessible scan', async () => {
    const { mocks, service } = createRepository();
    mocks.findByIdForUser.mockResolvedValueOnce(null);

    await expect(service.getById(OWNER_ID, SCAN_ID)).rejects.toBeInstanceOf(ScanNotFoundError);
  });

  it('renames a scan as the Owner', async () => {
    const { mocks, service } = createRepository();
    mocks.update.mockResolvedValueOnce(createRecord({ name: 'Updated Room' }));

    const result = await service.update(OWNER_ID, SCAN_ID, {
      name: 'Updated Room',
    });

    expect(mocks.update).toHaveBeenCalledWith(SCAN_ID, OWNER_ID, {
      name: 'Updated Room',
    });
    expect(result.name).toBe('Updated Room');
  });

  it('rejects rename from a Viewer', async () => {
    const { mocks, service } = createRepository();
    mocks.update.mockRejectedValueOnce(new ScanNotFoundError());

    await expect(
      service.update(VIEWER_ID, SCAN_ID, { name: 'Updated Room' }),
    ).rejects.toBeInstanceOf(ScanNotFoundError);
  });

  it('throws hidden not-found when updating a missing scan', async () => {
    const { mocks, service } = createRepository();
    mocks.update.mockRejectedValueOnce(new ScanNotFoundError());

    await expect(
      service.update(OWNER_ID, SCAN_ID, { name: 'Updated Room' }),
    ).rejects.toBeInstanceOf(ScanNotFoundError);
  });

  it('deletes a scan as the Owner', async () => {
    const { mocks, service } = createRepository();

    await service.delete(OWNER_ID, SCAN_ID);

    expect(mocks.softDelete).toHaveBeenCalledWith(SCAN_ID, OWNER_ID);
  });

  it('rejects delete from a Viewer', async () => {
    const { mocks, service } = createRepository();
    mocks.softDelete.mockRejectedValueOnce(new ScanNotFoundError());

    await expect(service.delete(VIEWER_ID, SCAN_ID)).rejects.toBeInstanceOf(ScanNotFoundError);
  });

  it('throws hidden not-found when deleting a missing scan', async () => {
    const { mocks, service } = createRepository();
    mocks.softDelete.mockRejectedValueOnce(new ScanNotFoundError());

    await expect(service.delete(OWNER_ID, SCAN_ID)).rejects.toBeInstanceOf(ScanNotFoundError);
  });
});
