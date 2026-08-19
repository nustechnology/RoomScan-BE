import { Prisma } from '../../generated/prisma/client.js';
import type { SyncResourceType, SyncStatus } from '../../modules/sync/sync.types.js';
import type { PrismaTransactionClient } from './prisma-idempotency.js';

interface DeleteChangeInput {
  projectId: string;
  ownerId: string;
  targetUserId?: string;
  resourceType: SyncResourceType;
  resourceId: string;
  revision: number;
  deletedAt: Date;
  syncStatus?: SyncStatus;
}

function json(value: Record<string, unknown>): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function supportsSync(transaction: PrismaTransactionClient): boolean {
  const candidate = transaction as unknown as {
    syncChange?: { create?: unknown };
  };
  return typeof candidate.syncChange?.create === 'function';
}

export function syncStatusForAsset(
  status: 'NONE' | 'PENDING' | 'UPLOADING' | 'UPLOADED' | 'FAILED',
): SyncStatus {
  if (status === 'UPLOADING') return 'SYNCING';
  if (status === 'UPLOADED') return 'SYNCED';
  if (status === 'FAILED') return 'FAILED';
  return 'PENDING';
}

export async function writeDeleteChange(
  transaction: PrismaTransactionClient,
  input: DeleteChangeInput,
): Promise<bigint> {
  if (!supportsSync(transaction)) return 0n;
  const change = await transaction.syncChange.create({
    data: {
      projectId: input.projectId,
      ownerId: input.ownerId,
      ...(input.targetUserId === undefined ? {} : { targetUserId: input.targetUserId }),
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      operation: 'DELETE',
      revision: input.revision,
      syncStatus: input.syncStatus ?? 'SYNCED',
      data: Prisma.DbNull,
      deletedAt: input.deletedAt,
      changedAt: input.deletedAt,
    },
    select: { id: true },
  });
  return change.id;
}

export async function writeDeleteChangesBatch(
  transaction: PrismaTransactionClient,
  inputs: DeleteChangeInput[],
): Promise<void> {
  if (!supportsSync(transaction) || inputs.length === 0) return;
  const candidate = transaction as unknown as {
    syncChange?: { createMany?: (args: { data: unknown[] }) => Promise<unknown> };
  };
  if (typeof candidate.syncChange?.createMany === 'function') {
    await candidate.syncChange.createMany({
      data: inputs.map((input) => ({
        projectId: input.projectId,
        ownerId: input.ownerId,
        ...(input.targetUserId === undefined ? {} : { targetUserId: input.targetUserId }),
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        operation: 'DELETE',
        revision: input.revision,
        syncStatus: input.syncStatus ?? 'SYNCED',
        data: Prisma.DbNull,
        deletedAt: input.deletedAt,
        changedAt: input.deletedAt,
      })),
    });
  } else {
    for (const input of inputs) {
      await writeDeleteChange(transaction, input);
    }
  }
}

export const writeDeleteChanges = writeDeleteChangesBatch;

export async function upsertSyncConflict(
  transaction: PrismaTransactionClient,
  input: {
    userId: string;
    projectId: string;
    resourceType: SyncResourceType;
    resourceId: string;
    serverRevision: number;
    refreshChangeId: bigint;
  },
): Promise<void> {
  if (!supportsSync(transaction)) return;
  await transaction.syncConflict.upsert({
    where: {
      userId_resourceType_resourceId: {
        userId: input.userId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
      },
    },
    create: input,
    update: {
      projectId: input.projectId,
      serverRevision: input.serverRevision,
      refreshChangeId: input.refreshChangeId,
      resolvedAt: null,
    },
  });
}

export async function resolveSyncConflict(
  transaction: PrismaTransactionClient,
  userId: string,
  resourceType: SyncResourceType,
  resourceId: string,
  resolvedAt: Date,
): Promise<void> {
  if (!supportsSync(transaction)) return;
  await transaction.syncConflict.updateMany({
    where: { userId, resourceType, resourceId, resolvedAt: null },
    data: { resolvedAt },
  });
}

export async function writeProjectUpsert(
  transaction: PrismaTransactionClient,
  projectId: string,
  options: { targetUserId?: string; syncStatus?: SyncStatus; changedAt?: Date } = {},
): Promise<bigint> {
  if (!supportsSync(transaction)) return 0n;
  const row = await transaction.project.findUniqueOrThrow({
    where: { id: projectId },
    select: {
      id: true,
      ownerId: true,
      owner: { select: { email: true } },
      name: true,
      description: true,
      revision: true,
      syncStatus: true,
      lastSyncedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  const change = await transaction.syncChange.create({
    data: {
      projectId: row.id,
      ownerId: row.ownerId,
      ...(options.targetUserId === undefined ? {} : { targetUserId: options.targetUserId }),
      resourceType: 'PROJECT',
      resourceId: row.id,
      operation: 'UPSERT',
      revision: row.revision,
      syncStatus: options.syncStatus ?? row.syncStatus,
      changedAt: options.changedAt ?? row.updatedAt,
      data: json({
        id: row.id,
        ownerId: row.ownerId,
        ownerEmail: row.owner.email,
        name: row.name,
        description: row.description,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
      }),
    },
    select: { id: true },
  });
  return change.id;
}

export async function writeScanUpsert(
  transaction: PrismaTransactionClient,
  scanId: string,
  options: { targetUserId?: string; syncStatus?: SyncStatus; changedAt?: Date } = {},
): Promise<bigint> {
  if (!supportsSync(transaction)) return 0n;
  const row = await transaction.scan.findUniqueOrThrow({
    where: { id: scanId },
    select: {
      id: true,
      projectId: true,
      project: { select: { ownerId: true } },
      createdById: true,
      creator: { select: { email: true } },
      name: true,
      description: true,
      thumbnail: true,
      assetStatus: true,
      syncStatus: true,
      modelVersion: true,
      revision: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  const change = await transaction.syncChange.create({
    data: {
      projectId: row.projectId,
      ownerId: row.project.ownerId,
      ...(options.targetUserId === undefined ? {} : { targetUserId: options.targetUserId }),
      resourceType: 'SCAN',
      resourceId: row.id,
      operation: 'UPSERT',
      revision: row.revision,
      syncStatus: options.syncStatus ?? row.syncStatus,
      changedAt: options.changedAt ?? row.updatedAt,
      data: json({
        id: row.id,
        projectId: row.projectId,
        createdById: row.createdById,
        creatorEmail: row.creator.email,
        name: row.name,
        description: row.description,
        thumbnail: row.thumbnail,
        assetStatus: row.assetStatus,
        modelVersion: row.modelVersion,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }),
    },
    select: { id: true },
  });
  return change.id;
}

export async function writeNoteUpsert(
  transaction: PrismaTransactionClient,
  noteId: string,
  options: { targetUserId?: string; syncStatus?: SyncStatus; changedAt?: Date } = {},
): Promise<bigint> {
  if (!supportsSync(transaction)) return 0n;
  const row = await transaction.note.findUniqueOrThrow({
    where: { id: noteId },
    select: {
      id: true,
      scanId: true,
      scan: { select: { projectId: true, project: { select: { ownerId: true } } } },
      createdById: true,
      creator: { select: { email: true } },
      title: true,
      content: true,
      color: true,
      position: true,
      orientation: true,
      modelVersion: true,
      revision: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  const change = await transaction.syncChange.create({
    data: {
      projectId: row.scan.projectId,
      ownerId: row.scan.project.ownerId,
      ...(options.targetUserId === undefined ? {} : { targetUserId: options.targetUserId }),
      resourceType: 'NOTE',
      resourceId: row.id,
      operation: 'UPSERT',
      revision: row.revision,
      syncStatus: options.syncStatus ?? 'SYNCED',
      changedAt: options.changedAt ?? row.updatedAt,
      data: json({
        id: row.id,
        scanId: row.scanId,
        createdById: row.createdById,
        creatorEmail: row.creator.email,
        title: row.title,
        content: row.content,
        color: row.color,
        position: row.position,
        orientation: row.orientation,
        modelVersion: row.modelVersion,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }),
    },
    select: { id: true },
  });
  return change.id;
}

export async function writeAssetUpsert(
  transaction: PrismaTransactionClient,
  assetId: string,
  options: { targetUserId?: string; syncStatus?: SyncStatus; changedAt?: Date } = {},
): Promise<bigint> {
  if (!supportsSync(transaction)) return 0n;
  const row = await transaction.scanAsset.findUniqueOrThrow({
    where: { id: assetId },
    select: {
      id: true,
      scanId: true,
      scan: { select: { projectId: true, project: { select: { ownerId: true } } } },
      assetType: true,
      revision: true,
      status: true,
      contentType: true,
      sizeBytes: true,
      checksum: true,
      modelVersion: true,
      uploadedAt: true,
      uploadUrlExpiresAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  const change = await transaction.syncChange.create({
    data: {
      projectId: row.scan.projectId,
      ownerId: row.scan.project.ownerId,
      ...(options.targetUserId === undefined ? {} : { targetUserId: options.targetUserId }),
      resourceType: 'SCAN_ASSET',
      resourceId: row.id,
      operation: 'UPSERT',
      revision: row.revision,
      syncStatus: options.syncStatus ?? syncStatusForAsset(row.status),
      changedAt: options.changedAt ?? row.updatedAt,
      data: json({
        id: row.id,
        scanId: row.scanId,
        assetType: row.assetType,
        status: row.status,
        contentType: row.contentType,
        sizeBytes: row.sizeBytes,
        checksum: row.checksum,
        modelVersion: row.modelVersion,
        uploadedAt: row.uploadedAt?.toISOString() ?? null,
        uploadUrlExpiresAt: row.uploadUrlExpiresAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }),
    },
    select: { id: true },
  });
  return change.id;
}

export async function writeAccessUpsert(
  transaction: PrismaTransactionClient,
  accessId: string,
  options: { targetUserId?: string; changedAt?: Date } = {},
): Promise<bigint> {
  if (!supportsSync(transaction)) return 0n;
  const row = await transaction.projectAccess.findUniqueOrThrow({
    where: { id: accessId },
    select: {
      id: true,
      projectId: true,
      project: { select: { ownerId: true } },
      userId: true,
      user: { select: { email: true } },
      role: true,
      acceptedAt: true,
      revision: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  const change = await transaction.syncChange.create({
    data: {
      projectId: row.projectId,
      ownerId: row.project.ownerId,
      ...(options.targetUserId === undefined ? {} : { targetUserId: options.targetUserId }),
      resourceType: 'PROJECT_ACCESS',
      resourceId: row.id,
      operation: 'UPSERT',
      revision: row.revision,
      syncStatus: 'SYNCED',
      changedAt: options.changedAt ?? row.updatedAt,
      data: json({
        id: row.id,
        projectId: row.projectId,
        userId: row.userId,
        userEmail: row.user.email,
        role: row.role,
        acceptedAt: row.acceptedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }),
    },
    select: { id: true },
  });
  return change.id;
}

export async function refreshProjectRollup(
  transaction: PrismaTransactionClient,
  projectId: string,
  changedAt: Date,
): Promise<void> {
  if (!supportsSync(transaction)) return;
  const project = await transaction.project.findUniqueOrThrow({
    where: { id: projectId },
    select: {
      scans: {
        where: { deletedAt: null },
        select: {
          assets: {
            where: { assetType: 'MODEL', deletedAt: null },
            select: { status: true },
          },
        },
      },
    },
  });
  const statuses = project.scans.map((scan) => scan.assets[0]?.status);
  const status: SyncStatus = statuses.some((value) => value === 'FAILED')
    ? 'FAILED'
    : statuses.some((value) => value === 'UPLOADING')
      ? 'SYNCING'
      : statuses.some((value) => value === undefined || value === 'PENDING')
        ? 'PENDING'
        : 'SYNCED';

  await transaction.project.update({
    where: { id: projectId },
    data: {
      syncStatus: status,
      updatedAt: changedAt,
      ...(status === 'SYNCED' ? { lastSyncedAt: changedAt } : {}),
    },
  });
  await writeProjectUpsert(transaction, projectId, { changedAt });
}

export async function refreshScanRollup(
  transaction: PrismaTransactionClient,
  scanId: string,
  changedAt: Date,
): Promise<string> {
  if (!supportsSync(transaction)) {
    const scan = await transaction.scan.findFirst({
      where: { id: scanId },
      select: { projectId: true },
    });
    if (scan === null) return '';
    await transaction.scan.update({ where: { id: scanId }, data: { updatedAt: changedAt } });
    await transaction.project.update({
      where: { id: scan.projectId },
      data: { updatedAt: changedAt },
    });
    return scan.projectId;
  }
  const scan = await transaction.scan.findUniqueOrThrow({
    where: { id: scanId },
    select: {
      projectId: true,
      assets: {
        where: { assetType: 'MODEL', deletedAt: null },
        select: { status: true },
      },
    },
  });
  const modelStatus = scan.assets[0]?.status;
  const syncStatus: SyncStatus =
    modelStatus === undefined ? 'PENDING' : syncStatusForAsset(modelStatus);
  const assetStatus = modelStatus ?? 'NONE';
  await transaction.scan.update({
    where: { id: scanId },
    data: {
      revision: { increment: 1 },
      syncStatus,
      assetStatus,
      updatedAt: changedAt,
    },
  });
  await writeScanUpsert(transaction, scanId, { changedAt });
  await refreshProjectRollup(transaction, scan.projectId, changedAt);
  return scan.projectId;
}

export async function hasProjectSyncState(
  transaction: PrismaTransactionClient,
  projectIds: string[],
): Promise<boolean> {
  if (!supportsSync(transaction) || projectIds.length === 0) return false;
  const count = await transaction.syncChange.count({
    where: { projectId: { in: projectIds } },
  });
  return count > 0;
}

export async function resetProjectSyncState(
  transaction: PrismaTransactionClient,
  projectIds: string[],
): Promise<void> {
  if (!supportsSync(transaction) || projectIds.length === 0) return;
  await transaction.syncConflict.deleteMany({
    where: { projectId: { in: projectIds } },
  });
  await transaction.syncChange.deleteMany({
    where: { projectId: { in: projectIds } },
  });
}

export async function writeProjectBootstrap(
  transaction: PrismaTransactionClient,
  projectId: string,
  targetUserId: string,
  changedAt: Date,
): Promise<void> {
  if (!supportsSync(transaction)) return;
  await writeProjectUpsert(transaction, projectId, { targetUserId, changedAt });
  const project = await transaction.project.findUniqueOrThrow({
    where: { id: projectId },
    select: {
      scans: {
        where: { deletedAt: null },
        select: {
          id: true,
          notes: { where: { deletedAt: null }, select: { id: true } },
          assets: { where: { deletedAt: null }, select: { id: true } },
        },
      },
    },
  });
  for (const scan of project.scans) {
    await writeScanUpsert(transaction, scan.id, { targetUserId, changedAt });
    for (const asset of scan.assets) {
      await writeAssetUpsert(transaction, asset.id, { targetUserId, changedAt });
    }
    for (const note of scan.notes) {
      await writeNoteUpsert(transaction, note.id, { targetUserId, changedAt });
    }
  }
}
