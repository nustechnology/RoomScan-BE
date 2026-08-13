import type { PrismaClient } from '../../generated/prisma/client.js';
import { AssetType as PrismaAssetType } from '../../generated/prisma/enums.js';
import { ProjectRole as PrismaProjectRole } from '../../generated/prisma/enums.js';
import { decodeSyncCursor, encodeSyncCursor } from '../../modules/sync/sync-cursor.js';
import type {
  SyncChange,
  SyncChangesOptions,
  SyncProjectStatusRecord,
  SyncRepository,
} from '../../modules/sync/sync.types.js';

function visibleProjectWhere(userId: string) {
  return {
    OR: [
      { ownerId: userId },
      {
        accesses: {
          some: {
            userId,
            role: PrismaProjectRole.VIEWER,
            revokedAt: null,
          },
        },
      },
    ],
  };
}

interface ChangeRow {
  id: string;
  updatedAt: Date;
  deletedAt: Date | null;
  revision: number;
}

function operationFor(row: ChangeRow): 'CREATE' | 'UPDATE' | 'DELETE' {
  if (row.deletedAt !== null) {
    return 'DELETE';
  }
  return row.revision === 1 ? 'CREATE' : 'UPDATE';
}

function compareDesc(
  a: { changedAt: Date; resourceId: string },
  b: { changedAt: Date; resourceId: string },
): number {
  const timeDifference = b.changedAt.getTime() - a.changedAt.getTime();
  if (timeDifference !== 0) {
    return timeDifference;
  }
  return a.resourceId < b.resourceId ? 1 : a.resourceId > b.resourceId ? -1 : 0;
}

export class PrismaSyncRepository implements SyncRepository {
  readonly #client: Pick<
    PrismaClient,
    'project' | 'scan' | 'note' | 'projectAccess' | '$transaction'
  >;

  constructor(
    client: Pick<PrismaClient, 'project' | 'scan' | 'note' | 'projectAccess' | '$transaction'>,
  ) {
    this.#client = client;
  }

  async listChanges(
    userId: string,
    options: SyncChangesOptions,
  ): Promise<{ changes: SyncChange[]; hasMore: boolean }> {
    const cursor = decodeSyncCursor(options.cursor);
    const afterWhere =
      cursor === null
        ? options.since === undefined
          ? {}
          : { updatedAt: { gt: options.since } }
        : {
            OR: [
              { updatedAt: { lt: new Date(cursor.updatedAt) } },
              { updatedAt: new Date(cursor.updatedAt), id: { lt: cursor.id } },
            ],
          };

    const projectWhere = visibleProjectWhere(userId);
    const take = options.limit + 1;

    const [projectRows, scanRows, noteRows] = await this.#client.$transaction([
      this.#client.project.findMany({
        where: { ...projectWhere, ...afterWhere },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take,
        select: { id: true, updatedAt: true, deletedAt: true, revision: true },
      }),
      this.#client.scan.findMany({
        where: { project: projectWhere, ...afterWhere },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take,
        select: {
          id: true,
          updatedAt: true,
          deletedAt: true,
          revision: true,
          syncStatus: true,
        },
      }),
      this.#client.note.findMany({
        where: { scan: { deletedAt: null, project: projectWhere }, ...afterWhere },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take,
        select: {
          id: true,
          updatedAt: true,
          deletedAt: true,
          revision: true,
        },
      }),
    ]);

    const merged: SyncChange[] = [];

    for (const row of projectRows) {
      merged.push({
        resourceType: 'project',
        resourceId: row.id,
        operation: operationFor(row),
        revision: row.revision,
        syncStatus: null,
        changedAt: row.updatedAt,
        deletedAt: row.deletedAt,
        cursor: encodeSyncCursor(row.updatedAt, row.id),
      });
    }
    for (const row of scanRows) {
      merged.push({
        resourceType: 'scan',
        resourceId: row.id,
        operation: operationFor(row),
        revision: row.revision,
        syncStatus: row.syncStatus,
        changedAt: row.updatedAt,
        deletedAt: row.deletedAt,
        cursor: encodeSyncCursor(row.updatedAt, row.id),
      });
    }
    for (const row of noteRows) {
      merged.push({
        resourceType: 'note',
        resourceId: row.id,
        operation: operationFor(row),
        revision: row.revision,
        syncStatus: null,
        changedAt: row.updatedAt,
        deletedAt: row.deletedAt,
        cursor: encodeSyncCursor(row.updatedAt, row.id),
      });
    }

    merged.sort((a, b) => compareDesc(a, b));
    const changes = merged.slice(0, options.limit);

    return { changes, hasMore: merged.length > options.limit };
  }

  async listProjectStatuses(userId: string): Promise<SyncProjectStatusRecord[]> {
    const projects = await this.#client.project.findMany({
      where: visibleProjectWhere(userId),
      select: { id: true },
    });

    const projectIds = projects.map((project) => project.id);
    if (projectIds.length === 0) {
      return [];
    }

    return this.#buildStatuses(projectIds);
  }

  async findProjectStatus(
    userId: string,
    projectId: string,
  ): Promise<SyncProjectStatusRecord | null> {
    const project = await this.#client.project.findFirst({
      where: { id: projectId, ...visibleProjectWhere(userId) },
      select: { id: true },
    });

    if (project === null) {
      return null;
    }

    const records = await this.#buildStatuses([projectId]);
    return records[0] ?? null;
  }

  async #buildStatuses(projectIds: string[]): Promise<SyncProjectStatusRecord[]> {
    const scans = await this.#client.scan.findMany({
      where: { projectId: { in: projectIds }, deletedAt: null },
      select: {
        projectId: true,
        syncStatus: true,
        updatedAt: true,
        _count: {
          select: {
            assets: {
              where: {
                assetType: PrismaAssetType.MODEL,
                status: 'UPLOADED',
              },
            },
          },
        },
      },
    });

    const byProject = new Map<string, typeof scans>();
    for (const scan of scans) {
      const entries = byProject.get(scan.projectId);
      if (entries === undefined) {
        byProject.set(scan.projectId, [scan]);
      } else {
        entries.push(scan);
      }
    }

    const statuses: SyncProjectStatusRecord[] = [];
    for (const projectId of projectIds) {
      const projectScans = byProject.get(projectId) ?? [];
      const counts = { pending: 0, syncing: 0, failed: 0, conflict: 0, synced: 0 };
      let lastSyncedAt: Date | null = null;

      for (const scan of projectScans) {
        switch (scan.syncStatus) {
          case 'PENDING':
            counts.pending += 1;
            break;
          case 'SYNCING':
            counts.syncing += 1;
            break;
          case 'FAILED':
            counts.failed += 1;
            break;
          case 'CONFLICT':
            counts.conflict += 1;
            break;
          case 'SYNCED':
            counts.synced += 1;
            if (lastSyncedAt === null || scan.updatedAt > lastSyncedAt) {
              lastSyncedAt = scan.updatedAt;
            }
            break;
        }
      }

      let syncStatus: SyncProjectStatusRecord['syncStatus'] = 'PENDING';
      if (counts.conflict > 0) {
        syncStatus = 'CONFLICT';
      } else if (counts.failed > 0) {
        syncStatus = 'FAILED';
      } else if (counts.syncing > 0) {
        syncStatus = 'SYNCING';
      } else if (counts.pending > 0) {
        syncStatus = 'PENDING';
      } else if (counts.synced > 0) {
        syncStatus = 'SYNCED';
      }

      const requiredAssetsUploaded =
        projectScans.length > 0 && projectScans.every((scan) => scan._count.assets === 1);

      statuses.push({
        projectId,
        syncStatus,
        pendingCount: counts.pending,
        syncingCount: counts.syncing,
        failedCount: counts.failed,
        conflictCount: counts.conflict,
        lastSyncedAt,
        requiredAssetsUploaded,
      });
    }

    return statuses;
  }
}
