import type { PrismaClient } from '../../generated/prisma/client.js';
import { ProjectRole as PrismaProjectRole } from '../../generated/prisma/enums.js';
import { RevisionConflictError } from '../../common/revision/revision.errors.js';
import type {
  IdempotencyContext,
  IdempotencyResult,
} from '../../common/idempotency/idempotency.types.js';
import { ProjectNotFoundError } from '../../modules/project/project.errors.js';
import type {
  ProjectCreateInput,
  ProjectListOptions,
  ProjectRecord,
  ProjectRepository,
  ProjectResult,
  ProjectRole,
  ProjectSort,
  ProjectUpdateInput,
} from '../../modules/project/project.types.js';
import {
  resolveSyncConflict,
  upsertSyncConflict,
  writeDeleteChange,
  writeDeleteChangesBatch,
  writeProjectUpsert,
} from './prisma-sync-writer.js';
import type { PrismaIdempotencyExecutor } from './prisma-idempotency.js';

const projectSelect = {
  id: true,
  name: true,
  description: true,
  ownerId: true,
  revision: true,
  syncStatus: true,
  lastSyncedAt: true,
  owner: {
    select: {
      id: true,
      email: true,
      displayName: true,
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
          notes: { where: { deletedAt: null } },
        },
      },
    },
  },
  _count: {
    select: {
      accesses: {
        where: {
          role: PrismaProjectRole.VIEWER,
          revokedAt: null,
          deletedAt: null,
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
} as const;

interface ProjectScanRow {
  id: string;
  name: string;
  description: string | null;
  thumbnail: string | null;
  assetStatus: 'NONE' | 'PENDING' | 'UPLOADING' | 'UPLOADED' | 'FAILED';
  syncStatus: 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED' | 'CONFLICT';
  createdAt: Date;
  _count: {
    notes: number;
  };
}

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  revision: number;
  syncStatus: 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED' | 'CONFLICT';
  lastSyncedAt: Date | null;
  owner: {
    id: string;
    email: string | null;
    displayName: string | null;
  };
  scans: ProjectScanRow[];
  _count: {
    accesses: number;
    scans: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

type SortDirection = 'asc' | 'desc';
type ProjectOrderBy = {
  updatedAt?: SortDirection;
  createdAt?: SortDirection;
  name?: SortDirection;
  id?: SortDirection;
};

function toProjectRecord(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    ownerId: row.ownerId,
    owner: row.owner,
    scanCount: row._count.scans,
    scans: row.scans.map((scan) => ({
      id: scan.id,
      name: scan.name,
      description: scan.description,
      thumbnail: scan.thumbnail,
      noteCount: scan._count.notes,
      assetStatus: scan.assetStatus,
      syncStatus: scan.syncStatus,
      createdAt: scan.createdAt,
    })),
    sharedCount: row._count.accesses,
    thumbnail: null,
    syncStatus: row.syncStatus,
    revision: row.revision,
    lastSyncedAt: row.lastSyncedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toOwnerResult(record: ProjectRecord): ProjectResult {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    owner: record.owner,
    scanCount: record.scanCount,
    scans: record.scans.map((scan) => ({ ...scan, createdAt: scan.createdAt.toISOString() })),
    sharedCount: record.sharedCount,
    thumbnail: record.thumbnail,
    syncStatus: record.syncStatus ?? 'SYNCED',
    revision: record.revision ?? 1,
    lastSyncedAt: record.lastSyncedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    permissions: {
      role: 'OWNER',
      canView: true,
      canEdit: true,
      canDelete: true,
      canShare: true,
      canCreateScan: true,
    },
  };
}

function orderByFor(sort: ProjectSort): ProjectOrderBy[] {
  const [field, direction] = sort.split(':') as ['updatedAt' | 'createdAt' | 'name', SortDirection];

  return [{ [field]: direction }, { id: direction }];
}

function viewableProjectWhere(id: string, userId: string) {
  return {
    id,
    deletedAt: null,
    OR: [
      { ownerId: userId },
      {
        accesses: {
          some: {
            userId,
            role: PrismaProjectRole.VIEWER,
            revokedAt: null,
            deletedAt: null,
          },
        },
      },
    ],
  };
}

export class PrismaProjectRepository implements ProjectRepository {
  readonly #client: Pick<PrismaClient, 'project' | '$transaction'>;
  readonly #idempotency: PrismaIdempotencyExecutor | undefined;

  constructor(
    client: Pick<PrismaClient, 'project' | '$transaction'>,
    idempotency?: PrismaIdempotencyExecutor,
  ) {
    this.#client = client;
    this.#idempotency = idempotency;
  }

  async create(ownerId: string, data: ProjectCreateInput): Promise<ProjectRecord> {
    return await this.#client.$transaction(async (transaction) => {
      const now = new Date();
      const row = await transaction.project.create({
        data: {
          ownerId,
          name: data.name,
          description: data.description,
          syncStatus: 'SYNCED',
          lastSyncedAt: now,
          createdAt: now,
          updatedAt: now,
        },
        select: projectSelect,
      });
      await writeProjectUpsert(transaction, row.id, { changedAt: now });
      return toProjectRecord(row);
    });
  }

  async createIdempotently(
    ownerId: string,
    data: ProjectCreateInput,
    context: IdempotencyContext,
  ): Promise<IdempotencyResult<ProjectResult>> {
    if (this.#idempotency === undefined) {
      throw new Error('Project idempotency is not configured');
    }
    return await this.#idempotency.execute(context, 201, async (transaction) => {
      const now = new Date();
      const row = await transaction.project.create({
        data: {
          ownerId,
          name: data.name,
          description: data.description,
          syncStatus: 'SYNCED',
          lastSyncedAt: now,
          createdAt: now,
          updatedAt: now,
        },
        select: projectSelect,
      });
      await writeProjectUpsert(transaction, row.id, { changedAt: now });
      return toOwnerResult(toProjectRecord(row));
    });
  }

  async list(
    ownerId: string,
    options: ProjectListOptions,
  ): Promise<{ items: ProjectRecord[]; total: number }> {
    const where = {
      ownerId,
      deletedAt: null,
      ...(options.search === undefined
        ? {}
        : {
            name: {
              contains: options.search,
              mode: 'insensitive' as const,
            },
          }),
    };
    const [rows, total] = await this.#client.$transaction([
      this.#client.project.findMany({
        where,
        orderBy: orderByFor(options.sort),
        skip: (options.page - 1) * options.limit,
        take: options.limit,
        select: projectSelect,
      }),
      this.#client.project.count({ where }),
    ]);

    return {
      items: rows.map(toProjectRecord),
      total,
    };
  }

  async findByIdForUser(
    id: string,
    userId: string,
  ): Promise<{ record: ProjectRecord; role: ProjectRole } | null> {
    const row = await this.#client.project.findFirst({
      where: viewableProjectWhere(id, userId),
      select: projectSelect,
    });

    if (row === null) {
      return null;
    }

    return {
      record: toProjectRecord(row),
      role: row.ownerId === userId ? 'OWNER' : 'VIEWER',
    };
  }

  async findAccessRole(id: string, userId: string): Promise<ProjectRole | null> {
    const project = await this.#client.project.findFirst({
      where: viewableProjectWhere(id, userId),
      select: {
        ownerId: true,
      },
    });

    if (project === null) {
      return null;
    }

    return project.ownerId === userId ? 'OWNER' : 'VIEWER';
  }

  async update(
    id: string,
    ownerId: string,
    expectedRevision: number,
    data: ProjectUpdateInput,
  ): Promise<ProjectRecord> {
    const outcome = await this.#client.$transaction(async (transaction) => {
      const changedAt = new Date();
      const result = await transaction.project.updateMany({
        where: { id, ownerId, deletedAt: null, revision: expectedRevision },
        data: {
          ...data,
          revision: { increment: 1 },
          updatedAt: changedAt,
        },
      });

      if (result.count === 0) {
        const current = await transaction.project.findFirst({
          where: { id, ownerId },
          select: { revision: true, deletedAt: true },
        });
        if (current === null) {
          throw new ProjectNotFoundError();
        }
        const refreshChangeId =
          current.deletedAt === null
            ? await writeProjectUpsert(transaction, id, {
                targetUserId: ownerId,
                syncStatus: 'CONFLICT',
                changedAt,
              })
            : await writeDeleteChange(transaction, {
                projectId: id,
                ownerId,
                targetUserId: ownerId,
                resourceType: 'PROJECT',
                resourceId: id,
                revision: current.revision,
                deletedAt: current.deletedAt,
                syncStatus: 'CONFLICT',
              });
        await upsertSyncConflict(transaction, {
          userId: ownerId,
          projectId: id,
          resourceType: 'PROJECT',
          resourceId: id,
          serverRevision: current.revision,
          refreshChangeId,
        });
        return { kind: 'conflict' as const, current };
      }

      await transaction.project.updateMany({
        where: { id, ownerId, deletedAt: null, syncStatus: 'SYNCED' },
        data: { lastSyncedAt: changedAt },
      });

      const row = await transaction.project.findFirst({
        where: { id, ownerId, deletedAt: null },
        select: projectSelect,
      });

      if (row === null) {
        throw new ProjectNotFoundError();
      }
      await resolveSyncConflict(transaction, ownerId, 'PROJECT', id, changedAt);
      await writeProjectUpsert(transaction, id, { changedAt });
      return { kind: 'updated' as const, record: toProjectRecord(row) };
    });

    if (outcome.kind === 'conflict') {
      throw new RevisionConflictError({
        projectId: id,
        resourceType: 'PROJECT',
        resourceId: id,
        currentRevision: outcome.current.revision,
        deleted: outcome.current.deletedAt !== null,
      });
    }
    return outcome.record;
  }

  async softDelete(id: string, ownerId: string, expectedRevision: number): Promise<number> {
    const outcome = await this.#client.$transaction(async (transaction) => {
      const project = await transaction.project.findFirst({
        where: { id, ownerId },
        select: {
          ownerId: true,
          revision: true,
          deletedAt: true,
          scans: {
            where: { deletedAt: null },
            select: {
              id: true,
              revision: true,
              notes: { where: { deletedAt: null }, select: { id: true, revision: true } },
              assets: { where: { deletedAt: null }, select: { id: true, revision: true } },
            },
          },
          accesses: {
            where: { revokedAt: null, deletedAt: null },
            select: { id: true, userId: true, revision: true },
          },
        },
      });

      if (project === null) {
        throw new ProjectNotFoundError();
      }

      if (project.deletedAt !== null) {
        return { kind: 'deleted' as const, revision: project.revision };
      }

      const deletedAt = new Date();
      if (project.revision !== expectedRevision) {
        const refreshChangeId = await writeProjectUpsert(transaction, id, {
          targetUserId: ownerId,
          syncStatus: 'CONFLICT',
          changedAt: deletedAt,
        });
        await upsertSyncConflict(transaction, {
          userId: ownerId,
          projectId: id,
          resourceType: 'PROJECT',
          resourceId: id,
          serverRevision: project.revision,
          refreshChangeId,
        });
        return { kind: 'conflict' as const, revision: project.revision };
      }

      const claimed = await transaction.project.updateMany({
        where: { id, ownerId, deletedAt: null, revision: expectedRevision },
        data: { deletedAt, revision: { increment: 1 }, updatedAt: deletedAt },
      });
      if (claimed.count === 0) {
        const current = await transaction.project.findFirst({
          where: { id, ownerId },
          select: { revision: true, deletedAt: true },
        });
        if (current === null) throw new ProjectNotFoundError();
        if (current.deletedAt !== null) {
          return { kind: 'deleted' as const, revision: current.revision };
        }
        const refreshChangeId = await writeProjectUpsert(transaction, id, {
          targetUserId: ownerId,
          syncStatus: 'CONFLICT',
          changedAt: deletedAt,
        });
        await upsertSyncConflict(transaction, {
          userId: ownerId,
          projectId: id,
          resourceType: 'PROJECT',
          resourceId: id,
          serverRevision: current.revision,
          refreshChangeId,
        });
        return { kind: 'conflict' as const, revision: current.revision };
      }

      const notes = (project.scans ?? []).flatMap((scan) => scan.notes ?? []);
      if (notes.length > 0) {
        await transaction.note.updateMany({
          where: { id: { in: notes.map((note) => note.id) } },
          data: { deletedAt, revision: { increment: 1 }, updatedAt: deletedAt },
        });
        await writeDeleteChangesBatch(
          transaction,
          notes.map((note) => ({
            projectId: id,
            ownerId,
            resourceType: 'NOTE',
            resourceId: note.id,
            revision: note.revision + 1,
            deletedAt,
          })),
        );
      }

      const assets = (project.scans ?? []).flatMap((scan) => scan.assets ?? []);
      if (assets.length > 0) {
        await transaction.scanAsset.updateMany({
          where: { id: { in: assets.map((asset) => asset.id) } },
          data: { deletedAt, revision: { increment: 1 }, updatedAt: deletedAt },
        });
        await writeDeleteChangesBatch(
          transaction,
          assets.map((asset) => ({
            projectId: id,
            ownerId,
            resourceType: 'SCAN_ASSET',
            resourceId: asset.id,
            revision: asset.revision + 1,
            deletedAt,
          })),
        );
      }

      const scans = project.scans ?? [];
      if (scans.length > 0) {
        await transaction.scan.updateMany({
          where: { id: { in: scans.map((scan) => scan.id) } },
          data: { deletedAt, revision: { increment: 1 }, updatedAt: deletedAt },
        });
        await writeDeleteChangesBatch(
          transaction,
          scans.map((scan) => ({
            projectId: id,
            ownerId,
            resourceType: 'SCAN',
            resourceId: scan.id,
            revision: scan.revision + 1,
            deletedAt,
          })),
        );
      }

      const accesses = project.accesses ?? [];
      if (accesses.length > 0) {
        await transaction.projectAccess.updateMany({
          where: { id: { in: accesses.map((access) => access.id) } },
          data: { revokedAt: deletedAt, revision: { increment: 1 }, updatedAt: deletedAt },
        });
        await writeDeleteChangesBatch(
          transaction,
          accesses.flatMap((access) => [
            {
              projectId: id,
              ownerId,
              resourceType: 'PROJECT_ACCESS' as const,
              resourceId: access.id,
              revision: access.revision + 1,
              deletedAt,
            },
            {
              projectId: id,
              ownerId,
              targetUserId: access.userId,
              resourceType: 'PROJECT_ACCESS' as const,
              resourceId: access.id,
              revision: access.revision + 1,
              deletedAt,
            },
          ]),
        );
      }
      await writeDeleteChange(transaction, {
        projectId: id,
        ownerId,
        resourceType: 'PROJECT',
        resourceId: id,
        revision: project.revision + 1,
        deletedAt,
      });
      await resolveSyncConflict(transaction, ownerId, 'PROJECT', id, deletedAt);
      return { kind: 'deleted' as const, revision: project.revision + 1 };
    });

    if (outcome.kind === 'conflict') {
      throw new RevisionConflictError({
        projectId: id,
        resourceType: 'PROJECT',
        resourceId: id,
        currentRevision: outcome.revision,
        deleted: false,
      });
    }
    return outcome.revision;
  }
}
