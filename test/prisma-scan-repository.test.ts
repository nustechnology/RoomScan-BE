import { describe, expect, it, vi } from 'vitest';

import { Prisma, type PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaScanRepository } from '../src/infrastructure/database/prisma-scan-repository.js';
import type { PrismaIdempotencyExecutor } from '../src/infrastructure/database/prisma-idempotency.js';
import { IdempotencyKeyConflictError } from '../src/common/idempotency/idempotency.errors.js';
import { ScanNotFoundError } from '../src/modules/scan/scan.errors.js';

const OWNER_ID = 'eb5d278f-c857-45c7-887d-7be65288cb75';
const VIEWER_ID = '8c53d31d-2788-48de-82a0-c4f219ca3701';
const PROJECT_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const SCAN_ID = 'f1e2d3c4-a5b6-7890-abcd-ef1234567890';
const CREATOR_ID = OWNER_ID;
const NOW = new Date('2026-07-29T10:00:00.000Z');

const scanSelect = {
  id: true,
  projectId: true,
  createdById: true,
  creator: {
    select: {
      id: true,
      email: true,
    },
  },
  name: true,
  description: true,
  thumbnail: true,
  assetStatus: true,
  syncStatus: true,
  modelVersion: true,
  revision: true,
  clientMutationId: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      notes: { where: { deletedAt: null } },
    },
  },
};

function createScanRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SCAN_ID,
    projectId: PROJECT_ID,
    createdById: CREATOR_ID,
    creator: {
      id: CREATOR_ID,
      email: 'owner@example.com',
    },
    name: 'Living Room',
    description: null,
    thumbnail: null,
    assetStatus: 'NONE',
    syncStatus: 'PENDING',
    modelVersion: 1,
    revision: 1,
    clientMutationId: null,
    deletedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    project: { ownerId: OWNER_ID },
    _count: { notes: 2 },
    ...overrides,
  };
}

function createClient() {
  const scan = {
    create: vi.fn().mockResolvedValue(createScanRow()),
    findFirst: vi.fn().mockResolvedValue(createScanRow()),
    findMany: vi.fn().mockResolvedValue([createScanRow()]),
    count: vi.fn().mockResolvedValue(1),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    update: vi.fn().mockResolvedValue(createScanRow()),
  };
  const project = {
    update: vi.fn().mockResolvedValue({}),
  };
  const note = {
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const scanAsset = {
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const transaction = vi.fn(async (operation: unknown) => {
    if (Array.isArray(operation)) {
      return Promise.all(operation);
    }

    return (
      operation as (client: {
        scan: typeof scan;
        project: typeof project;
        note: typeof note;
        scanAsset: typeof scanAsset;
      }) => Promise<unknown>
    )({ scan, project, note, scanAsset });
  });
  const client = {
    scan,
    project,
    $transaction: transaction,
  } as unknown as Pick<PrismaClient, 'scan' | 'project' | '$transaction'>;

  return { client, scan, project, note, scanAsset, transaction };
}

describe('PrismaScanRepository', () => {
  it('creates a new scan', async () => {
    const { client, scan } = createClient();
    const repository = new PrismaScanRepository(client);

    const result = await repository.create(PROJECT_ID, OWNER_ID, {
      name: 'Living Room',
      description: null,
    });

    const [createArguments] = scan.create.mock.calls[0] as unknown as [
      { data: Record<string, unknown>; select: unknown },
    ];
    expect(createArguments.data).toMatchObject({
      projectId: PROJECT_ID,
      createdById: OWNER_ID,
      name: 'Living Room',
      description: null,
    });
    expect(createArguments.data.createdAt).toBeInstanceOf(Date);
    expect(createArguments.data.updatedAt).toBeInstanceOf(Date);
    expect(createArguments.select).toEqual(scanSelect);
    expect(result.created).toBe(true);
    expect(result.record.name).toBe('Living Room');
    expect(result.record.projectId).toBe(PROJECT_ID);
  });

  it('creates a scan with a clientMutationId scoped to its project', async () => {
    const { client, scan } = createClient();
    scan.findFirst.mockResolvedValueOnce(null);
    const repository = new PrismaScanRepository(client);

    const result = await repository.create(PROJECT_ID, OWNER_ID, {
      name: 'Living Room',
      description: null,
      clientMutationId: 'mutation-abc',
    });

    expect(scan.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId: PROJECT_ID,
          clientMutationId: 'mutation-abc',
        },
      }),
    );
    const [createArguments] = scan.create.mock.calls[0] as unknown as [
      { data: Record<string, unknown>; select: unknown },
    ];
    expect(createArguments.data).toMatchObject({
      projectId: PROJECT_ID,
      createdById: OWNER_ID,
      name: 'Living Room',
      description: null,
      clientMutationId: 'mutation-abc',
    });
    expect(createArguments.data.createdAt).toBeInstanceOf(Date);
    expect(createArguments.data.updatedAt).toBeInstanceOf(Date);
    expect(createArguments.select).toEqual(scanSelect);
    expect(result.created).toBe(true);
  });

  it('creates scan metadata and optional asset sessions inside the receipt transaction', async () => {
    const { client, scan } = createClient();
    const scanAssetCreate = vi.fn().mockResolvedValue({});
    const execute = vi.fn(
      async (
        _context: unknown,
        statusCode: number,
        work: (transaction: unknown) => Promise<unknown>,
      ) => ({
        body: await work({ scan, scanAsset: { create: scanAssetCreate } }),
        statusCode,
        replayed: false,
      }),
    );
    const repository = new PrismaScanRepository(client, {
      execute,
    } as unknown as PrismaIdempotencyExecutor);
    const context = {
      userId: OWNER_ID,
      operation: 'CREATE_SCAN' as const,
      parentScope: `project:${PROJECT_ID}`,
      keyHash: 'key-hash',
      requestHash: 'request-hash',
    };
    const assetId = 'c0ffee00-0000-4000-8000-000000000001';

    const result = await repository.createWithUploadsIdempotently(
      SCAN_ID,
      PROJECT_ID,
      OWNER_ID,
      { name: 'Living Room', description: null },
      [
        {
          data: {
            id: assetId,
            scanId: SCAN_ID,
            assetType: 'MODEL',
            contentType: 'model/usdz',
            sizeBytes: 20_000_000,
            checksum: 'checksum',
            modelVersion: '1',
            storageKey: `scans/${SCAN_ID}/model`,
            idempotencyKey: null,
            uploadUrlExpiresAt: NOW,
          },
          response: {
            uploadSessionId: assetId,
            assetId,
            uploadUrl: 'https://storage/upload',
            uploadUrlExpiresAt: NOW.toISOString(),
          },
        },
      ],
      context,
    );

    expect(execute).toHaveBeenCalledWith(context, 201, expect.any(Function));
    const [scanArguments] = scan.create.mock.calls[0] as unknown as [
      { data: Record<string, unknown> },
    ];
    expect(scanArguments.data).toMatchObject({ id: SCAN_ID, assetStatus: 'PENDING' });
    const [assetArguments] = scanAssetCreate.mock.calls[0] as unknown as [
      { data: Record<string, unknown> },
    ];
    expect(assetArguments.data).toMatchObject({ id: assetId, idempotencyKey: null });
    expect(result.body.uploads?.scanFile?.assetId).toBe(assetId);
  });

  it('maps a historical legacy-key collision during transactional scan creation to 409', async () => {
    const { client } = createClient();
    const conflict = new Prisma.PrismaClientKnownRequestError('unique constraint', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['projectId', 'clientMutationId'] },
    });
    const repository = new PrismaScanRepository(client, {
      execute: vi.fn().mockRejectedValue(conflict),
    } as unknown as PrismaIdempotencyExecutor);

    await expect(
      repository.createWithUploadsIdempotently(
        SCAN_ID,
        PROJECT_ID,
        OWNER_ID,
        {
          name: 'Living Room',
          description: null,
          clientMutationId: 'historical-mutation',
        },
        [],
        {
          userId: OWNER_ID,
          operation: 'CREATE_SCAN',
          parentScope: `project:${PROJECT_ID}`,
          keyHash: 'key-hash',
          requestHash: 'request-hash',
        },
      ),
    ).rejects.toBeInstanceOf(IdempotencyKeyConflictError);
  });

  it('returns an existing active scan as not-created when clientMutationId collides in the project', async () => {
    const { client, scan } = createClient();
    const repository = new PrismaScanRepository(client);

    const result = await repository.create(PROJECT_ID, OWNER_ID, {
      name: 'Living Room',
      description: null,
      clientMutationId: 'existing-mutation',
    });

    expect(scan.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId: PROJECT_ID,
          clientMutationId: 'existing-mutation',
        },
      }),
    );
    expect(result.created).toBe(false);
    expect(result.record.name).toBe('Living Room');
    expect(result.record.id).toBe(SCAN_ID);
  });

  it('never restores a deleted scan when the legacy clientMutationId collides', async () => {
    const { client, scan } = createClient();
    scan.findFirst.mockResolvedValueOnce(
      createScanRow({ deletedAt: new Date('2026-08-01T00:00:00.000Z') }),
    );
    const repository = new PrismaScanRepository(client);

    await expect(
      repository.create(PROJECT_ID, OWNER_ID, {
        name: 'Renamed Room',
        description: 'Must stay deleted',
        clientMutationId: 'deleted-mutation',
      }),
    ).rejects.toBeInstanceOf(IdempotencyKeyConflictError);
    expect(scan.update).not.toHaveBeenCalled();
  });

  it('returns the existing scan when a concurrent duplicate insert raises P2002', async () => {
    const { client, scan } = createClient();
    const conflict = new Prisma.PrismaClientKnownRequestError('unique constraint', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['projectId', 'clientMutationId'] },
    });
    scan.findFirst.mockResolvedValueOnce(null);
    scan.create.mockRejectedValueOnce(conflict);
    const repository = new PrismaScanRepository(client);

    const result = await repository.create(PROJECT_ID, OWNER_ID, {
      name: 'Living Room',
      description: null,
      clientMutationId: 'mutation-abc',
    });

    expect(result.created).toBe(false);
    expect(scan.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: PROJECT_ID, clientMutationId: 'mutation-abc' },
      }),
    );
    expect(result.record.id).toBe(SCAN_ID);
  });

  it('rethrows non-duplicate errors from create', async () => {
    const { client, scan } = createClient();
    scan.findFirst.mockResolvedValueOnce(null);
    scan.create.mockRejectedValueOnce(new Error('boom'));
    const repository = new PrismaScanRepository(client);

    await expect(
      repository.create(PROJECT_ID, OWNER_ID, {
        name: 'Living Room',
        description: null,
        clientMutationId: 'mutation-abc',
      }),
    ).rejects.toThrow('boom');
  });

  it('lists active scans for a project with pagination and stable sorting', async () => {
    const { client, scan } = createClient();
    scan.count.mockResolvedValue(3);
    const repository = new PrismaScanRepository(client);

    const result = await repository.listByProject(PROJECT_ID, {
      page: 1,
      limit: 20,
      sort: 'createdAt:desc',
    });

    expect(scan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: PROJECT_ID, deletedAt: null },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 0,
        take: 20,
      }),
    );
    expect(scan.count).toHaveBeenCalledWith({ where: { projectId: PROJECT_ID, deletedAt: null } });
    expect(result.total).toBe(3);
    expect(result.items).toHaveLength(1);
  });

  it('returns the projectId for an existing scan', async () => {
    const { client, scan } = createClient();
    scan.findFirst.mockResolvedValueOnce(createScanRow());
    const repository = new PrismaScanRepository(client);

    const result = await repository.findProjectId(SCAN_ID);

    expect(result).toBe(PROJECT_ID);
  });

  it('returns null for a missing scan', async () => {
    const { client, scan } = createClient();
    scan.findFirst.mockResolvedValueOnce(null);
    const repository = new PrismaScanRepository(client);

    const result = await repository.findProjectId(SCAN_ID);

    expect(result).toBeNull();
  });

  it('finds an active scan the Owner can view in one lookup', async () => {
    const { client, scan } = createClient();
    scan.findFirst.mockResolvedValueOnce(createScanRow());
    const repository = new PrismaScanRepository(client);

    const result = await repository.findByIdForUser(SCAN_ID, OWNER_ID);

    expect(result).toMatchObject({ record: { id: SCAN_ID }, role: 'OWNER' });
    expect(scan.findFirst).toHaveBeenCalledWith({
      where: {
        id: SCAN_ID,
        deletedAt: null,
        OR: [
          {
            project: {
              deletedAt: null,
              OR: [
                { ownerId: OWNER_ID },
                {
                  accesses: {
                    some: {
                      userId: OWNER_ID,
                      role: 'VIEWER',
                      revokedAt: null,
                    },
                  },
                },
              ],
            },
          },
          {
            project: { deletedAt: null },
            accesses: {
              some: {
                userId: OWNER_ID,
                role: 'VIEWER',
                revokedAt: null,
              },
            },
          },
        ],
      },
      select: {
        ...scanSelect,
        project: { select: { ownerId: true } },
      },
    });
  });

  it('returns null when scan detail is absent or inaccessible', async () => {
    const { client, scan } = createClient();
    scan.findFirst.mockResolvedValueOnce(null);
    const repository = new PrismaScanRepository(client);

    const result = await repository.findByIdForUser(SCAN_ID, VIEWER_ID);

    expect(result).toBeNull();
  });

  it('returns Viewer for an active Viewer detail lookup', async () => {
    const { client, scan } = createClient();
    scan.findFirst.mockResolvedValueOnce(
      createScanRow({
        projectId: PROJECT_ID,
      }),
    );
    const repository = new PrismaScanRepository(client);

    const result = await repository.findByIdForUser(SCAN_ID, VIEWER_ID);

    expect(result).toMatchObject({ role: 'VIEWER' });
  });

  it('findAccessRole returns VIEWER for a scan-level viewer', async () => {
    const { client, scan } = createClient();
    scan.findFirst.mockResolvedValueOnce({ project: { ownerId: OWNER_ID } });
    const repository = new PrismaScanRepository(client);

    const result = await repository.findAccessRole(SCAN_ID, VIEWER_ID);

    expect(result).toBe('VIEWER');
    expect(scan.findFirst).toHaveBeenCalledWith({
      where: {
        id: SCAN_ID,
        deletedAt: null,
        OR: [
          {
            project: {
              deletedAt: null,
              OR: [
                { ownerId: VIEWER_ID },
                {
                  accesses: {
                    some: { userId: VIEWER_ID, role: 'VIEWER', revokedAt: null },
                  },
                },
              ],
            },
          },
          {
            project: { deletedAt: null },
            accesses: {
              some: { userId: VIEWER_ID, role: 'VIEWER', revokedAt: null },
            },
          },
        ],
      },
      select: { project: { select: { ownerId: true } } },
    });
  });

  it('findAccessRole returns null when the scan is inaccessible', async () => {
    const { client, scan } = createClient();
    scan.findFirst.mockResolvedValueOnce(null);
    const repository = new PrismaScanRepository(client);

    const result = await repository.findAccessRole(SCAN_ID, VIEWER_ID);

    expect(result).toBeNull();
  });

  it('findAccessRole returns null when the direct scan access was revoked', async () => {
    const { client, scan } = createClient();
    scan.findFirst.mockResolvedValueOnce(null);
    const repository = new PrismaScanRepository(client);

    const result = await repository.findAccessRole(SCAN_ID, VIEWER_ID);

    expect(result).toBeNull();
  });

  it('updates an active scan owned by the caller', async () => {
    const { client, scan, transaction } = createClient();
    const repository = new PrismaScanRepository(client);

    await repository.update(SCAN_ID, OWNER_ID, { name: 'Updated Room' });

    expect(scan.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: SCAN_ID, deletedAt: null, project: { ownerId: OWNER_ID, deletedAt: null } },
        data: { name: 'Updated Room' },
      }),
    );
    expect(transaction).toHaveBeenCalledOnce();
  });

  it('throws a hidden not-found error when an update affects no rows', async () => {
    const { client, scan } = createClient();
    scan.updateMany.mockResolvedValue({ count: 0 });
    const repository = new PrismaScanRepository(client);

    await expect(
      repository.update(SCAN_ID, OWNER_ID, { name: 'Updated Room' }),
    ).rejects.toBeInstanceOf(ScanNotFoundError);
    expect(scan.findFirst).not.toHaveBeenCalled();
  });

  it('soft-deletes a scan and touches the parent project updatedAt', async () => {
    const { client, scan, project } = createClient();
    scan.findFirst.mockResolvedValueOnce(
      createScanRow({ projectId: PROJECT_ID, revision: undefined, deletedAt: null }),
    );
    const repository = new PrismaScanRepository(client);

    await repository.softDelete(SCAN_ID, OWNER_ID);

    expect(scan.update).toHaveBeenCalledOnce();
    const scanUpdate = scan.update.mock.calls[0]?.[0] as
      { where: { id: string }; data: { deletedAt: unknown } } | undefined;
    expect(scanUpdate?.where).toEqual({ id: SCAN_ID });
    expect(scanUpdate?.data.deletedAt).toBeInstanceOf(Date);

    expect(project.update).toHaveBeenCalledOnce();
    const projectUpdate = project.update.mock.calls[0]?.[0] as
      { where: { id: string }; data: { updatedAt: unknown } } | undefined;
    expect(projectUpdate?.where).toEqual({ id: PROJECT_ID });
    expect(projectUpdate?.data.updatedAt).toBeInstanceOf(Date);
  });

  it('claims an Owner delete with an atomic revision predicate', async () => {
    const { client, scan } = createClient();
    scan.findFirst.mockResolvedValueOnce(
      createScanRow({ revision: 3, deletedAt: null, notes: [], assets: [] }),
    );
    const repository = new PrismaScanRepository(client);

    await expect(repository.softDelete(SCAN_ID, OWNER_ID, 3)).resolves.toBe(4);

    expect(scan.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: SCAN_ID,
          revision: 3,
          deletedAt: null,
          project: { ownerId: OWNER_ID },
        },
      }),
    );
  });

  it('keeps repeated deletion idempotent for the same Owner', async () => {
    const { client, scan, project, transaction } = createClient();
    scan.findFirst.mockResolvedValueOnce(
      createScanRow({ projectId: PROJECT_ID, revision: undefined, deletedAt: NOW }),
    );
    const repository = new PrismaScanRepository(client);

    await repository.softDelete(SCAN_ID, OWNER_ID);

    expect(scan.update).not.toHaveBeenCalled();
    expect(project.update).not.toHaveBeenCalled();
    expect(transaction).toHaveBeenCalledOnce();
  });

  it('updates asset status on an active scan with a soft-delete guard', async () => {
    const { client, scan } = createClient();
    const repository = new PrismaScanRepository(client);

    await repository.updateAssetStatus(SCAN_ID, {
      assetStatus: 'UPLOADED',
      syncStatus: 'SYNCED',
    });

    expect(scan.updateMany).toHaveBeenCalledWith({
      where: { id: SCAN_ID, deletedAt: null },
      data: { assetStatus: 'UPLOADED', syncStatus: 'SYNCED' },
    });
  });

  it('treats an asset status update affecting no rows as a no-op', async () => {
    const { client, scan } = createClient();
    scan.updateMany.mockResolvedValue({ count: 0 });
    const repository = new PrismaScanRepository(client);

    await expect(
      repository.updateAssetStatus(SCAN_ID, { assetStatus: 'UPLOADED', syncStatus: 'SYNCED' }),
    ).resolves.toBeUndefined();
  });

  it('persists a thumbnail display URL on an active scan', async () => {
    const { client, scan } = createClient();
    const repository = new PrismaScanRepository(client);

    await repository.updateThumbnail(SCAN_ID, 'http://storage/display/thumbnail');

    expect(scan.updateMany).toHaveBeenCalledWith({
      where: { id: SCAN_ID, deletedAt: null },
      data: { thumbnail: 'http://storage/display/thumbnail' },
    });
  });

  it('hides deletion from a Viewer or unrelated user', async () => {
    const { client, scan } = createClient();
    scan.findFirst.mockResolvedValueOnce(null);
    const repository = new PrismaScanRepository(client);

    await expect(repository.softDelete(SCAN_ID, VIEWER_ID)).rejects.toBeInstanceOf(
      ScanNotFoundError,
    );
  });

  it('batches descendant note and asset soft-deletions in one updateMany per type with sync tombstones', async () => {
    const { client, scan, note, scanAsset, transaction } = createClient();
    const project = {
      update: vi.fn().mockResolvedValue({}),
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: PROJECT_ID,
        ownerId: OWNER_ID,
        owner: { email: 'owner@example.com' },
        name: 'Project',
        description: null,
        revision: 1,
        syncStatus: 'SYNCED',
        lastSyncedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        scans: [],
      }),
    };
    const syncChange = {
      create: vi.fn().mockResolvedValue({ id: 1n }),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    };
    const syncConflict = {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    };

    transaction.mockImplementationOnce(async (operation: unknown) => {
      return (
        operation as (c: {
          scan: typeof scan;
          project: typeof project;
          note: typeof note;
          scanAsset: typeof scanAsset;
          syncChange: typeof syncChange;
          syncConflict: typeof syncConflict;
        }) => Promise<unknown>
      )({ scan, project, note, scanAsset, syncChange, syncConflict });
    });

    const NOTE_ID = '11111111-2222-3333-4444-555555555555';
    const ASSET_ID = '66666666-7777-8888-9999-000000000000';

    scan.findFirst.mockResolvedValueOnce(
      createScanRow({
        projectId: PROJECT_ID,
        revision: 1,
        deletedAt: null,
        notes: [{ id: NOTE_ID, revision: 2 }],
        assets: [{ id: ASSET_ID, revision: 3 }],
      }),
    );

    const repository = new PrismaScanRepository(client);
    await expect(repository.softDelete(SCAN_ID, OWNER_ID, 1)).resolves.toBe(2);

    const noteUpdate = note.updateMany.mock.calls[0]?.[0] as
      | { where: { id: { in: string[] } }; data: { deletedAt: unknown; revision: unknown } }
      | undefined;
    expect(noteUpdate?.where).toEqual({ id: { in: [NOTE_ID] } });
    expect(noteUpdate?.data.deletedAt).toBeInstanceOf(Date);
    expect(noteUpdate?.data.revision).toEqual({ increment: 1 });

    const assetUpdate = scanAsset.updateMany.mock.calls[0]?.[0] as
      | { where: { id: { in: string[] } }; data: { deletedAt: unknown; revision: unknown } }
      | undefined;
    expect(assetUpdate?.where).toEqual({ id: { in: [ASSET_ID] } });
    expect(assetUpdate?.data.deletedAt).toBeInstanceOf(Date);
    expect(assetUpdate?.data.revision).toEqual({ increment: 1 });

    expect(syncChange.createMany).toHaveBeenNthCalledWith(1, {
      data: [
        expect.objectContaining({
          resourceType: 'NOTE',
          resourceId: NOTE_ID,
          revision: 3,
          operation: 'DELETE',
        }),
      ],
    });
    expect(syncChange.createMany).toHaveBeenNthCalledWith(2, {
      data: [
        expect.objectContaining({
          resourceType: 'SCAN_ASSET',
          resourceId: ASSET_ID,
          revision: 4,
          operation: 'DELETE',
        }),
      ],
    });
  });
});
