import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaScanRepository } from '../src/infrastructure/database/prisma-scan-repository.js';
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
  clientMutationId: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
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
    clientMutationId: null,
    deletedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    project: { ownerId: OWNER_ID },
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
  const transaction = vi.fn(async (operation: unknown) => {
    if (Array.isArray(operation)) {
      return Promise.all(operation);
    }

    return (
      operation as (client: { scan: typeof scan; project: typeof project }) => Promise<unknown>
    )({ scan, project });
  });
  const client = {
    scan,
    project,
    $transaction: transaction,
  } as unknown as Pick<PrismaClient, 'scan' | 'project' | '$transaction'>;

  return { client, scan, project, transaction };
}

describe('PrismaScanRepository', () => {
  it('creates a new scan', async () => {
    const { client, scan } = createClient();
    const repository = new PrismaScanRepository(client);

    const result = await repository.create(PROJECT_ID, OWNER_ID, {
      name: 'Living Room',
      description: null,
    });

    expect(scan.create).toHaveBeenCalledWith({
      data: {
        projectId: PROJECT_ID,
        createdById: OWNER_ID,
        name: 'Living Room',
        description: null,
      },
      select: scanSelect,
    });
    expect(result.name).toBe('Living Room');
    expect(result.projectId).toBe(PROJECT_ID);
  });

  it('creates a scan with a clientMutationId', async () => {
    const { client, scan } = createClient();
    scan.findFirst.mockResolvedValueOnce(null);
    const repository = new PrismaScanRepository(client);

    await repository.create(PROJECT_ID, OWNER_ID, {
      name: 'Living Room',
      description: null,
      clientMutationId: 'mutation-abc',
    });

    expect(scan.create).toHaveBeenCalledWith({
      data: {
        projectId: PROJECT_ID,
        createdById: OWNER_ID,
        name: 'Living Room',
        description: null,
        clientMutationId: 'mutation-abc',
      },
      select: scanSelect,
    });
  });

  it('returns an existing active scan when clientMutationId collides', async () => {
    const { client, scan } = createClient();
    const repository = new PrismaScanRepository(client);

    const result = await repository.create(PROJECT_ID, OWNER_ID, {
      name: 'Living Room',
      description: null,
      clientMutationId: 'existing-mutation',
    });

    expect(scan.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientMutationId: 'existing-mutation', project: { deletedAt: null } },
      }),
    );
    expect(result.name).toBe('Living Room');
    expect(result.id).toBe(SCAN_ID);
  });

  it('restores a deleted scan when clientMutationId collides with a deleted row', async () => {
    const { client, scan, transaction } = createClient();
    scan.findFirst.mockResolvedValueOnce(
      createScanRow({ deletedAt: new Date('2026-08-01T00:00:00.000Z') }),
    );
    const repository = new PrismaScanRepository(client);

    const result = await repository.create(PROJECT_ID, OWNER_ID, {
      name: 'Living Room',
      description: null,
      clientMutationId: 'deleted-mutation',
    });

    expect(transaction).toHaveBeenCalledOnce();
    expect(result.name).toBe('Living Room');
  });

  it('finds an active scan by clientMutationId', async () => {
    const { client, scan } = createClient();
    const repository = new PrismaScanRepository(client);

    const result = await repository.findByClientMutationId('existing-mutation');

    expect(scan.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientMutationId: 'existing-mutation', project: { deletedAt: null } },
      }),
    );
    expect(result).not.toBeNull();
  });

  it('returns null when no active scan matches clientMutationId', async () => {
    const { client, scan } = createClient();
    scan.findFirst.mockResolvedValueOnce(null);
    const repository = new PrismaScanRepository(client);

    const result = await repository.findByClientMutationId('missing-mutation');

    expect(result).toBeNull();
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
    scan.findFirst.mockResolvedValueOnce(createScanRow({ projectId: PROJECT_ID, deletedAt: null }));
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

  it('keeps repeated deletion idempotent for the same Owner', async () => {
    const { client, scan, project, transaction } = createClient();
    scan.findFirst.mockResolvedValueOnce(createScanRow({ projectId: PROJECT_ID, deletedAt: NOW }));
    const repository = new PrismaScanRepository(client);

    await repository.softDelete(SCAN_ID, OWNER_ID);

    expect(scan.update).not.toHaveBeenCalled();
    expect(project.update).not.toHaveBeenCalled();
    expect(transaction).toHaveBeenCalledOnce();
  });

  it('hides deletion from a Viewer or unrelated user', async () => {
    const { client, scan } = createClient();
    scan.findFirst.mockResolvedValueOnce(null);
    const repository = new PrismaScanRepository(client);

    await expect(repository.softDelete(SCAN_ID, VIEWER_ID)).rejects.toBeInstanceOf(
      ScanNotFoundError,
    );
  });
});
