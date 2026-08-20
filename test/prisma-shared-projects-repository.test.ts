import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaSharedProjectsRepository } from '../src/infrastructure/database/prisma-shared-projects-repository.js';

const PROJECT_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const USER_ID = 'f1a2b3c4-d5e6-7890-abcd-ef1234567890';
const OWNER_ID = 'eb5d278f-c857-45c7-887d-7be65288cb75';
const NOW = new Date('2026-07-29T10:00:00.000Z');

function createAccessRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'access-id',
    revision: 1,
    revokedAt: null,
    deletedAt: null,
    project: {
      id: PROJECT_ID,
      ownerId: OWNER_ID,
      name: 'District 2 Apartment',
      description: null,
      deletedAt: null,
      updatedAt: NOW,
      owner: { id: OWNER_ID, email: 'owner@example.com' },
      _count: { scans: 2 },
    },
    ...overrides,
  };
}

function createClient() {
  const projectAccess = {
    findMany: vi.fn().mockResolvedValue([createAccessRow()]),
    count: vi.fn().mockResolvedValue(1),
    findFirst: vi.fn().mockResolvedValue(createAccessRow()),
    findUnique: vi.fn().mockResolvedValue({ revokedAt: null }),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const project = {
    findFirst: vi.fn().mockResolvedValue({ ownerId: OWNER_ID }),
  };
  const transaction = vi.fn(async (operation: unknown) => {
    if (Array.isArray(operation)) {
      return await Promise.all(operation as readonly Promise<unknown>[]);
    }
    return await (
      operation as (transactionClient: {
        projectAccess: typeof projectAccess;
        project: typeof project;
      }) => Promise<unknown>
    )({ projectAccess, project });
  });
  const client = {
    projectAccess,
    project,
    $transaction: transaction,
  } as unknown as Pick<PrismaClient, 'projectAccess' | 'project' | '$transaction'>;

  return { client, projectAccess, project, transaction };
}

describe('PrismaSharedProjectsRepository', () => {
  it('list queries the current user’s Viewer access and counts the same set', async () => {
    const { client, projectAccess, transaction } = createClient();

    const result = await new PrismaSharedProjectsRepository(client).list(USER_ID, {
      page: 2,
      limit: 5,
      sort: 'updatedAt:desc',
    });

    expect(projectAccess.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: USER_ID, role: 'VIEWER', deletedAt: null },
        orderBy: [{ project: { updatedAt: 'desc' } }, { project: { id: 'desc' } }],
        skip: 5,
        take: 5,
      }),
    );
    expect(projectAccess.count).toHaveBeenCalledWith({
      where: { userId: USER_ID, role: 'VIEWER', deletedAt: null },
    });
    expect(transaction).toHaveBeenCalledOnce();
    expect(result.total).toBe(1);
    expect(result.items).toEqual([
      {
        id: PROJECT_ID,
        name: 'District 2 Apartment',
        description: null,
        owner: { id: OWNER_ID, email: 'owner@example.com' },
        scanCount: 2,
        thumbnail: null,
        updatedAt: NOW,
        projectDeletedAt: null,
        accessRevokedAt: null,
        accessDeletedAt: null,
      },
    ]);
  });

  it('list applies a case-insensitive project name search', async () => {
    const { client, projectAccess } = createClient();

    await new PrismaSharedProjectsRepository(client).list(USER_ID, {
      search: 'garden',
      page: 1,
      limit: 5,
      sort: 'name:asc',
    });

    expect(projectAccess.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: USER_ID,
          role: 'VIEWER',
          deletedAt: null,
          project: { name: { contains: 'garden', mode: 'insensitive' } },
        },
        orderBy: [{ project: { name: 'asc' } }, { project: { id: 'asc' } }],
      }),
    );
  });

  it('findSharedForUser returns the record even when access is revoked', async () => {
    const { client, projectAccess } = createClient();
    projectAccess.findFirst.mockResolvedValue(
      createAccessRow({
        revokedAt: NOW,
        deletedAt: null,
        project: {
          ...createAccessRow().project,
          deletedAt: null,
          scans: [
            {
              id: 'f1e2d3c4-a5b6-7890-abcd-ef1234567890',
              name: 'Living Room',
              description: null,
              thumbnail: null,
              assetStatus: 'UPLOADED',
              syncStatus: 'SYNCED',
              createdAt: NOW,
              _count: { notes: 3 },
            },
          ],
        },
      }),
    );

    const result = await new PrismaSharedProjectsRepository(client).findSharedForUser(
      PROJECT_ID,
      USER_ID,
    );

    expect(projectAccess.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: PROJECT_ID, userId: USER_ID, role: 'VIEWER', deletedAt: null },
      }),
    );
    expect(result?.accessRevokedAt).toEqual(NOW);
    expect(result?.accessDeletedAt).toBeNull();
    expect(result?.projectDeletedAt).toBeNull();
    expect(result?.scans).toEqual([
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
    ]);
  });

  it('findSharedForUser returns null without an access record', async () => {
    const { client, projectAccess } = createClient();
    projectAccess.findFirst.mockResolvedValue(null);

    await expect(
      new PrismaSharedProjectsRepository(client).findSharedForUser(PROJECT_ID, USER_ID),
    ).resolves.toBeNull();
    expect(projectAccess.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: PROJECT_ID, userId: USER_ID, role: 'VIEWER', deletedAt: null },
      }),
    );
  });

  it('findAccessStatus reads the revocation and removal state of the access row', async () => {
    const { client, projectAccess } = createClient();
    projectAccess.findFirst.mockResolvedValue({ revokedAt: NOW, deletedAt: null });

    const result = await new PrismaSharedProjectsRepository(client).findAccessStatus(
      PROJECT_ID,
      USER_ID,
    );

    expect(projectAccess.findFirst).toHaveBeenCalledWith({
      where: { projectId: PROJECT_ID, userId: USER_ID, role: 'VIEWER' },
      select: { revokedAt: true, deletedAt: true },
    });
    expect(result).toEqual({ revokedAt: NOW, deletedAt: null });
  });

  it('findAccessStatus returns null when the access row is missing', async () => {
    const { client, projectAccess } = createClient();
    projectAccess.findFirst.mockResolvedValue(null);

    await expect(
      new PrismaSharedProjectsRepository(client).findAccessStatus(PROJECT_ID, USER_ID),
    ).resolves.toBeNull();
    expect(projectAccess.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: PROJECT_ID, userId: USER_ID, role: 'VIEWER' },
      }),
    );
  });

  it('findProjectOwner returns the project owner', async () => {
    const { client, project } = createClient();

    await expect(
      new PrismaSharedProjectsRepository(client).findProjectOwner(PROJECT_ID),
    ).resolves.toBe(OWNER_ID);
    expect(project.findFirst).toHaveBeenCalledWith({
      where: { id: PROJECT_ID },
      select: { ownerId: true },
    });
  });

  it('findProjectOwner returns null for an unknown project', async () => {
    const { client, project } = createClient();
    project.findFirst.mockResolvedValue(null);

    await expect(
      new PrismaSharedProjectsRepository(client).findProjectOwner(PROJECT_ID),
    ).resolves.toBeNull();
  });

  it('removeFromShared marks only the current viewer access as removed', async () => {
    const { client, projectAccess } = createClient();

    const result = await new PrismaSharedProjectsRepository(client).removeFromShared(
      PROJECT_ID,
      USER_ID,
      NOW,
    );

    expect(projectAccess.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'access-id',
        userId: USER_ID,
        role: 'VIEWER',
        deletedAt: null,
        revision: 1,
      },
      data: { deletedAt: NOW, revision: { increment: 1 }, updatedAt: NOW },
    });
    expect(result).toBe(true);
  });

  it('removeFromShared is idempotent when already removed', async () => {
    const { client, projectAccess } = createClient();
    projectAccess.findFirst.mockResolvedValue(createAccessRow({ deletedAt: NOW }));

    const result = await new PrismaSharedProjectsRepository(client).removeFromShared(
      PROJECT_ID,
      USER_ID,
      NOW,
    );

    expect(projectAccess.updateMany).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it('removeFromShared marks an owner-revoked access row as removed', async () => {
    const { client, projectAccess } = createClient();
    projectAccess.findFirst.mockResolvedValue(createAccessRow({ revokedAt: NOW, deletedAt: null }));

    const result = await new PrismaSharedProjectsRepository(client).removeFromShared(
      PROJECT_ID,
      USER_ID,
      NOW,
    );

    expect(projectAccess.updateMany).toHaveBeenCalledOnce();
    expect(result).toBe(true);
  });

  it('removeFromShared never removes an OWNER access row', async () => {
    const { client, projectAccess } = createClient();
    projectAccess.updateMany.mockResolvedValue({ count: 0 });

    const result = await new PrismaSharedProjectsRepository(client).removeFromShared(
      PROJECT_ID,
      USER_ID,
      NOW,
    );

    expect(projectAccess.updateMany).toHaveBeenCalledOnce();
    expect(result).toBe(false);
  });

  it('removeFromShared returns false when the concurrent update fails', async () => {
    const { client, projectAccess } = createClient();
    projectAccess.updateMany.mockResolvedValue({ count: 0 });

    const result = await new PrismaSharedProjectsRepository(client).removeFromShared(
      PROJECT_ID,
      USER_ID,
      NOW,
    );

    expect(result).toBe(false);
  });

  it('removeFromShared returns false when no access row exists', async () => {
    const { client, projectAccess } = createClient();
    projectAccess.findFirst.mockResolvedValue(null);

    const result = await new PrismaSharedProjectsRepository(client).removeFromShared(
      PROJECT_ID,
      USER_ID,
      NOW,
    );

    expect(result).toBe(false);
    expect(projectAccess.updateMany).not.toHaveBeenCalled();
  });
});
