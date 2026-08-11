import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaProjectRepository } from '../src/infrastructure/database/prisma-project-repository.js';
import { ProjectNotFoundError } from '../src/modules/project/project.errors.js';

const OWNER_ID = 'eb5d278f-c857-45c7-887d-7be65288cb75';
const VIEWER_ID = '8c53d31d-2788-48de-82a0-c4f219ca3701';
const PROJECT_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const NOW = new Date('2026-07-29T10:00:00.000Z');
const expectedProjectSelect = {
  id: true,
  name: true,
  description: true,
  ownerId: true,
  owner: {
    select: {
      id: true,
      email: true,
    },
  },
  scans: {
    where: {
      deletedAt: null,
    },
    orderBy: {
      createdAt: 'desc',
    },
    select: {
      id: true,
      name: true,
      description: true,
      thumbnail: true,
      assetStatus: true,
      syncStatus: true,
      createdAt: true,
      _count: {
        select: {
          notes: true,
        },
      },
    },
  },
  _count: {
    select: {
      accesses: {
        where: {
          role: 'VIEWER',
          revokedAt: null,
        },
      },
      scans: {
        where: {
          deletedAt: null,
        },
      },
    },
  },
  createdAt: true,
  updatedAt: true,
};

function createRow() {
  return {
    id: PROJECT_ID,
    name: 'Apartment scan',
    description: 'First floor',
    ownerId: OWNER_ID,
    owner: {
      id: OWNER_ID,
      email: 'owner@example.com',
    },
    scans: [],
    _count: {
      accesses: 2,
      scans: 0,
    },
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function createClient() {
  const project = {
    create: vi.fn().mockResolvedValue(createRow()),
    findMany: vi.fn().mockResolvedValue([createRow()]),
    count: vi.fn().mockResolvedValue(1),
    findFirst: vi.fn().mockResolvedValue(createRow()),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    update: vi.fn().mockResolvedValue(createRow()),
  };
  const projectAccess = {
    updateMany: vi.fn().mockResolvedValue({ count: 2 }),
  };
  const transaction = vi.fn(async (operation: unknown) => {
    if (Array.isArray(operation)) {
      return Promise.all(operation);
    }

    return (
      operation as (client: {
        project: typeof project;
        projectAccess: typeof projectAccess;
      }) => Promise<unknown>
    )({ project, projectAccess });
  });
  const client = {
    project,
    $transaction: transaction,
  } as unknown as Pick<PrismaClient, 'project' | '$transaction'>;

  return { client, project, projectAccess, transaction };
}

describe('PrismaProjectRepository', () => {
  it('creates a project and maps response aggregates', async () => {
    const { client, project } = createClient();
    const repository = new PrismaProjectRepository(client);

    const result = await repository.create(OWNER_ID, {
      name: 'Apartment scan',
      description: 'First floor',
    });

    expect(project.create).toHaveBeenCalledWith({
      data: {
        ownerId: OWNER_ID,
        name: 'Apartment scan',
        description: 'First floor',
      },
      select: expectedProjectSelect,
    });
    expect(result).toMatchObject({
      owner: {
        id: OWNER_ID,
        email: 'owner@example.com',
      },
      scanCount: 0,
      scans: [],
      sharedCount: 2,
      thumbnail: null,
      syncStatus: null,
    });
  });

  it('maps nested scans with their note counts into project records', async () => {
    const { client, project } = createClient();
    project.findFirst.mockResolvedValueOnce({
      ...createRow(),
      _count: { accesses: 1, scans: 1 },
      scans: [
        {
          id: 'f1e2d3c4-a5b6-7890-abcd-ef1234567890',
          name: 'Living Room',
          description: null,
          thumbnail: 'http://storage.local/download/scans/scan/thumbnail',
          assetStatus: 'UPLOADED',
          syncStatus: 'SYNCED',
          createdAt: NOW,
          _count: { notes: 3 },
        },
      ],
    });
    const repository = new PrismaProjectRepository(client);

    const result = await repository.findByIdForUser(PROJECT_ID, OWNER_ID);

    expect(result?.record.scanCount).toBe(1);
    expect(result?.record.scans).toEqual([
      {
        id: 'f1e2d3c4-a5b6-7890-abcd-ef1234567890',
        name: 'Living Room',
        description: null,
        thumbnail: 'http://storage.local/download/scans/scan/thumbnail',
        noteCount: 3,
        assetStatus: 'UPLOADED',
        syncStatus: 'SYNCED',
        createdAt: NOW,
      },
    ]);
  });

  it('lists only active owned projects with search, offset pagination, and stable sorting', async () => {
    const { client, project, transaction } = createClient();
    project.count.mockResolvedValue(8);
    const repository = new PrismaProjectRepository(client);

    const result = await repository.list(OWNER_ID, {
      search: 'căn hộ',
      page: 2,
      limit: 5,
      sort: 'name:asc',
    });

    const where = {
      ownerId: OWNER_ID,
      deletedAt: null,
      name: {
        contains: 'căn hộ',
        mode: 'insensitive',
      },
    };
    expect(project.findMany).toHaveBeenCalledWith({
      where,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      skip: 5,
      take: 5,
      select: expectedProjectSelect,
    });
    expect(project.count).toHaveBeenCalledWith({ where });
    expect(transaction).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ total: 8 });
    expect(result.items).toHaveLength(1);
  });

  it.each([
    ['updatedAt:desc', [{ updatedAt: 'desc' }, { id: 'desc' }]],
    ['updatedAt:asc', [{ updatedAt: 'asc' }, { id: 'asc' }]],
    ['createdAt:desc', [{ createdAt: 'desc' }, { id: 'desc' }]],
    ['createdAt:asc', [{ createdAt: 'asc' }, { id: 'asc' }]],
    ['name:desc', [{ name: 'desc' }, { id: 'desc' }]],
  ] as const)('uses stable ordering for %s', async (sort, orderBy) => {
    const { client, project } = createClient();
    const repository = new PrismaProjectRepository(client);

    await repository.list(OWNER_ID, { page: 1, limit: 5, sort });

    expect(project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy,
      }),
    );
  });

  it('finds an active project that the Owner can view in one lookup', async () => {
    const { client, project } = createClient();
    const repository = new PrismaProjectRepository(client);

    await expect(repository.findByIdForUser(PROJECT_ID, OWNER_ID)).resolves.toMatchObject({
      record: { id: PROJECT_ID },
      role: 'OWNER',
    });
    expect(project.findFirst).toHaveBeenCalledWith({
      where: {
        id: PROJECT_ID,
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
      select: expectedProjectSelect,
    });
  });

  it('returns null when project detail is absent or inaccessible', async () => {
    const { client, project } = createClient();
    project.findFirst.mockResolvedValue(null);
    const repository = new PrismaProjectRepository(client);

    await expect(repository.findByIdForUser(PROJECT_ID, VIEWER_ID)).resolves.toBeNull();
  });

  it('returns Viewer for an active Viewer detail lookup', async () => {
    const { client, project } = createClient();
    project.findFirst.mockResolvedValue({ ...createRow(), ownerId: OWNER_ID });
    const repository = new PrismaProjectRepository(client);

    await expect(repository.findByIdForUser(PROJECT_ID, VIEWER_ID)).resolves.toMatchObject({
      record: { id: PROJECT_ID },
      role: 'VIEWER',
    });
  });

  it('recognizes the Owner through the shared access lookup', async () => {
    const { client, project } = createClient();
    project.findFirst.mockResolvedValue({ ownerId: OWNER_ID });
    const repository = new PrismaProjectRepository(client);

    await expect(repository.findAccessRole(PROJECT_ID, OWNER_ID)).resolves.toBe('OWNER');
    expect(project.findFirst).toHaveBeenCalledWith({
      where: {
        id: PROJECT_ID,
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
      select: { ownerId: true },
    });
  });

  it('recognizes an active Viewer and hides revoked or missing access', async () => {
    const { client, project } = createClient();
    project.findFirst.mockResolvedValueOnce({ ownerId: OWNER_ID }).mockResolvedValueOnce(null);
    const repository = new PrismaProjectRepository(client);

    await expect(repository.findAccessRole(PROJECT_ID, VIEWER_ID)).resolves.toBe('VIEWER');
    await expect(repository.findAccessRole(PROJECT_ID, VIEWER_ID)).resolves.toBeNull();
  });

  it('updates and reads only an active project owned by the caller in one transaction', async () => {
    const { client, project, transaction } = createClient();
    const repository = new PrismaProjectRepository(client);

    await repository.update(PROJECT_ID, OWNER_ID, {
      name: 'Updated',
      description: null,
    });

    expect(project.updateMany).toHaveBeenCalledWith({
      where: { id: PROJECT_ID, ownerId: OWNER_ID, deletedAt: null },
      data: { name: 'Updated', description: null },
    });
    expect(project.findFirst).toHaveBeenCalledWith({
      where: { id: PROJECT_ID, ownerId: OWNER_ID, deletedAt: null },
      select: expectedProjectSelect,
    });
    expect(transaction).toHaveBeenCalledOnce();
  });

  it('throws a hidden not-found error when an update affects no rows', async () => {
    const { client, project } = createClient();
    project.updateMany.mockResolvedValue({ count: 0 });
    const repository = new PrismaProjectRepository(client);

    await expect(
      repository.update(PROJECT_ID, OWNER_ID, { name: 'Updated' }),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
    expect(project.findFirst).not.toHaveBeenCalled();
  });

  it('throws if the project disappears after an update', async () => {
    const { client, project } = createClient();
    project.findFirst.mockResolvedValue(null);
    const repository = new PrismaProjectRepository(client);

    await expect(
      repository.update(PROJECT_ID, OWNER_ID, { name: 'Updated' }),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
  });

  it('soft-deletes a project and revokes active Viewer access in one transaction', async () => {
    const { client, project, projectAccess } = createClient();
    project.findFirst.mockResolvedValueOnce({ deletedAt: null });
    const repository = new PrismaProjectRepository(client);

    await repository.softDelete(PROJECT_ID, OWNER_ID);

    expect(project.findFirst).toHaveBeenCalledWith({
      where: { id: PROJECT_ID, ownerId: OWNER_ID },
      select: { deletedAt: true },
    });
    expect(project.update).toHaveBeenCalledOnce();
    const projectUpdate = project.update.mock.calls[0]?.[0] as
      | {
          where: { id: string };
          data: { deletedAt: unknown };
        }
      | undefined;
    expect(projectUpdate?.where).toEqual({ id: PROJECT_ID });
    expect(projectUpdate?.data.deletedAt).toBeInstanceOf(Date);

    expect(projectAccess.updateMany).toHaveBeenCalledOnce();
    const accessUpdate = projectAccess.updateMany.mock.calls[0]?.[0] as
      | {
          where: { projectId: string; revokedAt: null };
          data: { revokedAt: unknown };
        }
      | undefined;
    expect(accessUpdate?.where).toEqual({
      projectId: PROJECT_ID,
      revokedAt: null,
    });
    expect(accessUpdate?.data.revokedAt).toBe(projectUpdate?.data.deletedAt);
  });

  it('keeps repeated deletion idempotent for the same Owner', async () => {
    const { client, project, projectAccess } = createClient();
    project.findFirst.mockResolvedValueOnce({ deletedAt: NOW });
    const repository = new PrismaProjectRepository(client);

    await expect(repository.softDelete(PROJECT_ID, OWNER_ID)).resolves.toBeUndefined();
    expect(project.update).not.toHaveBeenCalled();
    expect(projectAccess.updateMany).not.toHaveBeenCalled();
  });

  it('hides deletion from users who are not the Owner', async () => {
    const { client, project } = createClient();
    project.findFirst.mockResolvedValueOnce(null);
    const repository = new PrismaProjectRepository(client);

    await expect(repository.softDelete(PROJECT_ID, VIEWER_ID)).rejects.toBeInstanceOf(
      ProjectNotFoundError,
    );
  });
});
