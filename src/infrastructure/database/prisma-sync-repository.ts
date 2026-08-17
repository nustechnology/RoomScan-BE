import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import type {
  SyncChangeRecord,
  SyncRepository,
  SyncResourceType,
  SyncStatus,
  SyncStatusItem,
} from '../../modules/sync/sync.types.js';
import type { PrismaTransactionClient } from './prisma-idempotency.js';
import {
  writeAccessUpsert,
  writeAssetUpsert,
  writeDeleteChange,
  writeNoteUpsert,
  writeProjectUpsert,
  writeScanUpsert,
} from './prisma-sync-writer.js';

interface RawSyncChange {
  id: bigint;
  resourceType: SyncResourceType;
  resourceId: string;
  operation: 'UPSERT' | 'DELETE';
  revision: number;
  syncStatus: SyncStatus;
  data: Prisma.JsonValue | null;
  deletedAt: Date | null;
  changedAt: Date;
}

function toRecord(row: RawSyncChange): SyncChangeRecord {
  return {
    sequence: row.id,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    operation: row.operation,
    revision: row.revision,
    syncStatus: row.syncStatus,
    changedAt: row.changedAt,
    deletedAt: row.deletedAt,
    data:
      row.data !== null && typeof row.data === 'object' && !Array.isArray(row.data)
        ? row.data
        : null,
  };
}

function visibilitySql(userId: string): Prisma.Sql {
  return Prisma.sql`
    (
      (
        c."ownerId" = ${userId}::uuid
        AND (c."targetUserId" IS NULL OR c."targetUserId" = ${userId}::uuid)
      )
      OR (
        c."targetUserId" = ${userId}::uuid
        AND c."resourceType" = 'PROJECT_ACCESS'::"SyncResourceType"
      )
      OR (
        c."resourceType" <> 'PROJECT_ACCESS'::"SyncResourceType"
        AND (c."targetUserId" IS NULL OR c."targetUserId" = ${userId}::uuid)
        AND EXISTS (
          SELECT 1
          FROM project_accesses pa
          WHERE pa."projectId" = c."projectId"
            AND pa."userId" = ${userId}::uuid
            AND pa.role = 'VIEWER'::"ProjectRole"
            AND pa."revokedAt" IS NULL
        )
      )
    )
  `;
}

type ConflictForAcknowledgement = {
  projectId: string;
  resourceType: SyncResourceType;
  resourceId: string;
};

async function writeResolvedConflictSnapshot(
  transaction: PrismaTransactionClient,
  userId: string,
  conflict: ConflictForAcknowledgement,
  changedAt: Date,
): Promise<void> {
  if (conflict.resourceType === 'PROJECT') {
    const project = await transaction.project.findUnique({
      where: { id: conflict.resourceId },
      select: { ownerId: true, revision: true, deletedAt: true },
    });
    if (project === null) return;
    if (project.deletedAt === null) {
      await writeProjectUpsert(transaction, conflict.resourceId, {
        targetUserId: userId,
        changedAt,
      });
    } else {
      await writeDeleteChange(transaction, {
        projectId: conflict.projectId,
        ownerId: project.ownerId,
        targetUserId: userId,
        resourceType: 'PROJECT',
        resourceId: conflict.resourceId,
        revision: project.revision,
        deletedAt: project.deletedAt,
      });
    }
    return;
  }

  if (conflict.resourceType === 'SCAN') {
    const scan = await transaction.scan.findUnique({
      where: { id: conflict.resourceId },
      select: {
        revision: true,
        deletedAt: true,
        project: { select: { ownerId: true } },
      },
    });
    if (scan === null) return;
    if (scan.deletedAt === null) {
      await writeScanUpsert(transaction, conflict.resourceId, {
        targetUserId: userId,
        changedAt,
      });
    } else {
      await writeDeleteChange(transaction, {
        projectId: conflict.projectId,
        ownerId: scan.project.ownerId,
        targetUserId: userId,
        resourceType: 'SCAN',
        resourceId: conflict.resourceId,
        revision: scan.revision,
        deletedAt: scan.deletedAt,
      });
    }
    return;
  }

  if (conflict.resourceType === 'NOTE') {
    const note = await transaction.note.findUnique({
      where: { id: conflict.resourceId },
      select: {
        revision: true,
        deletedAt: true,
        scan: { select: { project: { select: { ownerId: true } } } },
      },
    });
    if (note === null) return;
    if (note.deletedAt === null) {
      await writeNoteUpsert(transaction, conflict.resourceId, {
        targetUserId: userId,
        changedAt,
      });
    } else {
      await writeDeleteChange(transaction, {
        projectId: conflict.projectId,
        ownerId: note.scan.project.ownerId,
        targetUserId: userId,
        resourceType: 'NOTE',
        resourceId: conflict.resourceId,
        revision: note.revision,
        deletedAt: note.deletedAt,
      });
    }
    return;
  }

  if (conflict.resourceType === 'SCAN_ASSET') {
    const asset = await transaction.scanAsset.findUnique({
      where: { id: conflict.resourceId },
      select: {
        revision: true,
        deletedAt: true,
        scan: { select: { project: { select: { ownerId: true } } } },
      },
    });
    if (asset === null) return;
    if (asset.deletedAt === null) {
      await writeAssetUpsert(transaction, conflict.resourceId, {
        targetUserId: userId,
        changedAt,
      });
    } else {
      await writeDeleteChange(transaction, {
        projectId: conflict.projectId,
        ownerId: asset.scan.project.ownerId,
        targetUserId: userId,
        resourceType: 'SCAN_ASSET',
        resourceId: conflict.resourceId,
        revision: asset.revision,
        deletedAt: asset.deletedAt,
      });
    }
    return;
  }

  const access = await transaction.projectAccess.findUnique({
    where: { id: conflict.resourceId },
    select: {
      revision: true,
      revokedAt: true,
      project: { select: { ownerId: true } },
    },
  });
  if (access === null) return;
  if (access.revokedAt === null) {
    await writeAccessUpsert(transaction, conflict.resourceId, {
      targetUserId: userId,
      changedAt,
    });
  } else {
    await writeDeleteChange(transaction, {
      projectId: conflict.projectId,
      ownerId: access.project.ownerId,
      targetUserId: userId,
      resourceType: 'PROJECT_ACCESS',
      resourceId: conflict.resourceId,
      revision: access.revision,
      deletedAt: access.revokedAt,
    });
  }
}

export class PrismaSyncRepository implements SyncRepository {
  readonly #client: PrismaClient;

  constructor(client: PrismaClient) {
    this.#client = client;
  }

  async getWatermark(): Promise<bigint> {
    const latest = await this.#client.syncChange.findFirst({
      orderBy: { id: 'desc' },
      select: { id: true },
    });
    return latest?.id ?? 0n;
  }

  async listSnapshot(
    userId: string,
    watermark: bigint,
    after: { resourceType: SyncResourceType; resourceId: string } | null,
    limit: number,
  ): Promise<{ items: SyncChangeRecord[]; hasMore: boolean }> {
    const afterSql =
      after === null
        ? Prisma.empty
        : Prisma.sql`
          AND (
            latest."resourceType"::text > ${after.resourceType}
            OR (
              latest."resourceType"::text = ${after.resourceType}
              AND latest."resourceId" > ${after.resourceId}::uuid
            )
          )
        `;
    const rows = await this.#client.$queryRaw<RawSyncChange[]>(Prisma.sql`
      WITH visible AS (
        SELECT c.*
        FROM sync_changes c
        WHERE c.id <= ${watermark}
          AND ${visibilitySql(userId)}
      ), latest AS (
        SELECT DISTINCT ON (v."resourceType", v."resourceId")
          v.id,
          v."resourceType",
          v."resourceId",
          v.operation,
          v.revision,
          v."syncStatus",
          v.data,
          v."deletedAt",
          v."changedAt"
        FROM visible v
        ORDER BY v."resourceType", v."resourceId", v.id DESC
      )
      SELECT *
      FROM latest
      WHERE latest.operation = 'UPSERT'::"SyncOperation"
        ${afterSql}
      ORDER BY latest."resourceType"::text ASC, latest."resourceId" ASC
      LIMIT ${limit + 1}
    `);
    const hasMore = rows.length > limit;
    return { items: rows.slice(0, limit).map(toRecord), hasMore };
  }

  async listIncremental(
    userId: string,
    afterSequence: bigint,
    throughSequence: bigint,
    since: Date | null,
    limit: number,
  ): Promise<{ items: SyncChangeRecord[] }> {
    const sinceSql = since === null ? Prisma.empty : Prisma.sql`AND c."changedAt" >= ${since}`;
    const rows = await this.#client.$queryRaw<RawSyncChange[]>(Prisma.sql`
      SELECT
        c.id,
        c."resourceType",
        c."resourceId",
        c.operation,
        c.revision,
        c."syncStatus",
        c.data,
        c."deletedAt",
        c."changedAt"
      FROM sync_changes c
      WHERE c.id > ${afterSequence}
        AND c.id <= ${throughSequence}
        ${sinceSql}
        AND ${visibilitySql(userId)}
      ORDER BY c.id ASC
      LIMIT ${limit}
    `);
    return { items: rows.map(toRecord) };
  }

  async acknowledge(userId: string, sequence: bigint, acknowledgedAt: Date): Promise<void> {
    const conflicts = await this.#client.syncConflict.findMany({
      where: {
        userId,
        resolvedAt: null,
        refreshChangeId: { lte: sequence },
      },
      select: { projectId: true, resourceType: true, resourceId: true },
    });
    if (conflicts.length === 0) {
      return;
    }

    const projectIds = [...new Set(conflicts.map((conflict) => conflict.projectId))];
    await this.#client.$transaction(async (transaction) => {
      await transaction.syncConflict.updateMany({
        where: {
          userId,
          resolvedAt: null,
          refreshChangeId: { lte: sequence },
        },
        data: { resolvedAt: acknowledgedAt },
      });

      for (const projectId of projectIds) {
        const project = await transaction.project.findFirst({
          where: { id: projectId, deletedAt: null },
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
        const ready =
          project !== null &&
          project.scans.every((scan) => scan.assets.some((asset) => asset.status === 'UPLOADED'));
        if (ready) {
          await transaction.project.update({
            where: { id: projectId },
            data: { syncStatus: 'SYNCED', lastSyncedAt: acknowledgedAt },
          });
        }
      }

      for (const conflict of conflicts) {
        await writeResolvedConflictSnapshot(transaction, userId, conflict, acknowledgedAt);
      }
    });
  }

  async listStatuses(userId: string, projectId?: string): Promise<SyncStatusItem[]> {
    const projects = await this.#client.project.findMany({
      where: {
        deletedAt: null,
        ...(projectId === undefined ? {} : { id: projectId }),
        OR: [
          { ownerId: userId },
          {
            accesses: {
              some: { userId, role: 'VIEWER', revokedAt: null },
            },
          },
        ],
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      select: {
        id: true,
        lastSyncedAt: true,
        scans: {
          where: { deletedAt: null },
          select: {
            assets: {
              where: { assetType: 'MODEL', deletedAt: null },
              select: { status: true },
            },
          },
        },
        _count: {
          select: {
            syncConflicts: { where: { userId, resolvedAt: null } },
          },
        },
      },
    });

    return projects.map((project) => {
      let pendingCount = 0;
      let syncingCount = 0;
      let failedCount = 0;

      for (const scan of project.scans) {
        const model = scan.assets[0];
        if (model === undefined || model.status === 'PENDING') {
          pendingCount += 1;
        } else if (model.status === 'UPLOADING') {
          syncingCount += 1;
        } else if (model.status === 'FAILED') {
          failedCount += 1;
        }
      }

      const conflictCount = project._count.syncConflicts;
      const syncStatus: SyncStatus =
        conflictCount > 0
          ? 'CONFLICT'
          : failedCount > 0
            ? 'FAILED'
            : syncingCount > 0
              ? 'SYNCING'
              : pendingCount > 0
                ? 'PENDING'
                : 'SYNCED';

      return {
        projectId: project.id,
        syncStatus,
        pendingCount,
        syncingCount,
        failedCount,
        conflictCount,
        lastSyncedAt: project.lastSyncedAt?.toISOString() ?? null,
        requiredAssetsUploaded: project.scans.every((scan) =>
          scan.assets.some((asset) => asset.status === 'UPLOADED'),
        ),
      };
    });
  }
}
