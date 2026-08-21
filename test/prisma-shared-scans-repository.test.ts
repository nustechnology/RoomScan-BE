import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaSharedScansRepository } from '../src/infrastructure/database/prisma-shared-scans-repository.js';

const SCAN_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const USER_ID = 'f1a2b3c4-d5e6-7890-abcd-ef1234567890';
const OWNER_ID = 'eb5d278f-c857-45c7-887d-7be65288cb75';
const PROJECT_ID = '11111111-2222-4333-8444-555555555555';
const NOW = new Date('2026-07-29T10:00:00.000Z');

function createAccessRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'access-id',
    revokedAt: null,
    deletedAt: null,
    scan: {
      id: SCAN_ID,
      projectId: PROJECT_ID,
      name: 'Living Room Scan',
      description: null,
      thumbnail: null,
      deletedAt: null,
      updatedAt: NOW,
      assetStatus: 'UPLOADED',
      syncStatus: 'SYNCED',
      modelVersion: 1,
      creator: { id: OWNER_ID, email: 'owner@example.com' },
      _count: { notes: 2 },
    },
    ...overrides,
  };
}

function createClient() {
  const scanAccess = {
    findMany: vi.fn().mockResolvedValue([createAccessRow()]),
    count: vi.fn().mockResolvedValue(1),
    findFirst: vi.fn().mockResolvedValue(createAccessRow()),
    findUnique: vi.fn().mockResolvedValue({ deletedAt: null }),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const scan = {
    findFirst: vi.fn().mockResolvedValue({ project: { ownerId: OWNER_ID } }),
  };
  const transaction = vi.fn(async (operations: readonly Promise<unknown>[]) => {
    const results = [];
    for (const operation of operations) {
      results.push(await operation);
    }
    return results;
  });
  const client = {
    scanAccess,
    scan,
    $transaction: transaction,
  } as unknown as Pick<PrismaClient, 'scanAccess' | 'scan' | '$transaction'>;

  return { client, scanAccess, scan, transaction };
}

describe('PrismaSharedScansRepository', () => {
  it('list queries the current user’s Viewer access and counts the same set', async () => {
    const { client, scanAccess, transaction } = createClient();

    const result = await new PrismaSharedScansRepository(client).list(USER_ID, {
      page: 2,
      limit: 5,
      sort: 'updatedAt:desc',
    });

    expect(scanAccess.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: USER_ID, role: 'VIEWER', deletedAt: null },
        orderBy: [{ scan: { updatedAt: 'desc' } }, { scan: { id: 'desc' } }],
        skip: 5,
        take: 5,
      }),
    );
    expect(scanAccess.count).toHaveBeenCalledWith({
      where: { userId: USER_ID, role: 'VIEWER', deletedAt: null },
    });
    expect(transaction).toHaveBeenCalledOnce();
    expect(result.total).toBe(1);
    expect(result.items).toEqual([
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
        updatedAt: NOW,
        scanDeletedAt: null,
        accessRevokedAt: null,
        accessDeletedAt: null,
      },
    ]);
  });

  it('list applies a case-insensitive scan name search', async () => {
    const { client, scanAccess } = createClient();

    await new PrismaSharedScansRepository(client).list(USER_ID, {
      search: 'living',
      page: 1,
      limit: 5,
      sort: 'name:asc',
    });

    expect(scanAccess.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: USER_ID,
          role: 'VIEWER',
          deletedAt: null,
          scan: { name: { contains: 'living', mode: 'insensitive' } },
        },
        orderBy: [{ scan: { name: 'asc' } }, { scan: { id: 'asc' } }],
      }),
    );
  });

  it('findSharedForUser returns the record even when access is revoked', async () => {
    const { client, scanAccess } = createClient();
    scanAccess.findFirst.mockResolvedValue(
      createAccessRow({
        revokedAt: NOW,
        deletedAt: null,
        scan: { ...createAccessRow().scan, deletedAt: null },
      }),
    );

    const result = await new PrismaSharedScansRepository(client).findSharedForUser(
      SCAN_ID,
      USER_ID,
    );

    expect(scanAccess.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { scanId: SCAN_ID, userId: USER_ID, role: 'VIEWER', deletedAt: null },
      }),
    );
    expect(result?.accessRevokedAt).toEqual(NOW);
    expect(result?.accessDeletedAt).toBeNull();
    expect(result?.scanDeletedAt).toBeNull();
  });

  it('findSharedForUser returns null without an access record', async () => {
    const { client, scanAccess } = createClient();
    scanAccess.findFirst.mockResolvedValue(null);

    await expect(
      new PrismaSharedScansRepository(client).findSharedForUser(SCAN_ID, USER_ID),
    ).resolves.toBeNull();
    expect(scanAccess.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { scanId: SCAN_ID, userId: USER_ID, role: 'VIEWER', deletedAt: null },
      }),
    );
  });

  it('findAccessStatus reads the revocation and removal state of the access row', async () => {
    const { client, scanAccess } = createClient();
    scanAccess.findFirst.mockResolvedValue({ revokedAt: NOW, deletedAt: null });

    const result = await new PrismaSharedScansRepository(client).findAccessStatus(SCAN_ID, USER_ID);

    expect(scanAccess.findFirst).toHaveBeenCalledWith({
      where: { scanId: SCAN_ID, userId: USER_ID, role: 'VIEWER' },
      select: { revokedAt: true, deletedAt: true },
    });
    expect(result).toEqual({ revokedAt: NOW, deletedAt: null });
  });

  it('findAccessStatus returns null when the access row is missing', async () => {
    const { client, scanAccess } = createClient();
    scanAccess.findFirst.mockResolvedValue(null);

    await expect(
      new PrismaSharedScansRepository(client).findAccessStatus(SCAN_ID, USER_ID),
    ).resolves.toBeNull();
  });

  it('findScanOwner returns the project owner of the scan', async () => {
    const { client, scan } = createClient();

    await expect(new PrismaSharedScansRepository(client).findScanOwner(SCAN_ID)).resolves.toBe(
      OWNER_ID,
    );
    expect(scan.findFirst).toHaveBeenCalledWith({
      where: { id: SCAN_ID },
      select: { project: { select: { ownerId: true } } },
    });
  });

  it('findScanOwner returns null for an unknown scan', async () => {
    const { client, scan } = createClient();
    scan.findFirst.mockResolvedValue(null);

    await expect(
      new PrismaSharedScansRepository(client).findScanOwner(SCAN_ID),
    ).resolves.toBeNull();
  });

  it('removeFromShared marks only the current viewer access as removed', async () => {
    const { client, scanAccess } = createClient();

    const result = await new PrismaSharedScansRepository(client).removeFromShared(
      SCAN_ID,
      USER_ID,
      NOW,
    );

    expect(scanAccess.updateMany).toHaveBeenCalledWith({
      where: { scanId: SCAN_ID, userId: USER_ID, role: 'VIEWER', deletedAt: null },
      data: { deletedAt: NOW, updatedAt: NOW },
    });
    expect(result).toEqual({ removedAt: NOW });
  });

  it('removeFromShared is idempotent when already removed', async () => {
    const { client, scanAccess } = createClient();
    scanAccess.findFirst.mockResolvedValue({ id: 'access-id', deletedAt: NOW });

    const result = await new PrismaSharedScansRepository(client).removeFromShared(
      SCAN_ID,
      USER_ID,
      NOW,
    );

    expect(scanAccess.updateMany).not.toHaveBeenCalled();
    expect(result).toEqual({ removedAt: NOW });
  });

  it('removeFromShared marks an owner-revoked access row as removed', async () => {
    const { client, scanAccess } = createClient();
    scanAccess.findFirst.mockResolvedValue(createAccessRow({ revokedAt: NOW, deletedAt: null }));

    const result = await new PrismaSharedScansRepository(client).removeFromShared(
      SCAN_ID,
      USER_ID,
      NOW,
    );

    expect(scanAccess.updateMany).toHaveBeenCalledOnce();
    expect(result).toEqual({ removedAt: NOW });
  });

  it('removeFromShared returns null when the concurrent update failed while still active', async () => {
    const { client, scanAccess } = createClient();
    scanAccess.updateMany.mockResolvedValue({ count: 0 });
    scanAccess.findUnique.mockResolvedValue({ deletedAt: null });

    const result = await new PrismaSharedScansRepository(client).removeFromShared(
      SCAN_ID,
      USER_ID,
      NOW,
    );

    expect(scanAccess.findUnique).toHaveBeenCalledWith({
      where: { id: 'access-id' },
      select: { deletedAt: true },
    });
    expect(result).toBeNull();
  });

  it('removeFromShared preserves the persisted tombstone on a concurrent removal race', async () => {
    const { client, scanAccess } = createClient();
    const persisted = new Date('2026-07-29T09:00:00.000Z');
    scanAccess.updateMany.mockResolvedValue({ count: 0 });
    scanAccess.findUnique.mockResolvedValue({ deletedAt: persisted });

    const result = await new PrismaSharedScansRepository(client).removeFromShared(
      SCAN_ID,
      USER_ID,
      NOW,
    );

    expect(result).toEqual({ removedAt: persisted });
  });

  it('removeFromShared returns null when no access row exists', async () => {
    const { client, scanAccess } = createClient();
    scanAccess.findFirst.mockResolvedValue(null);

    const result = await new PrismaSharedScansRepository(client).removeFromShared(
      SCAN_ID,
      USER_ID,
      NOW,
    );

    expect(result).toBeNull();
    expect(scanAccess.updateMany).not.toHaveBeenCalled();
  });
});
