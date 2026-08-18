import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { ProjectRole as PrismaProjectRole } from '../../generated/prisma/enums.js';
import { IdempotencyKeyConflictError } from '../../common/idempotency/idempotency.errors.js';
import type {
  IdempotencyContext,
  IdempotencyResult,
} from '../../common/idempotency/idempotency.types.js';
import { RevisionConflictError } from '../../common/revision/revision.errors.js';
import { ScanNotFoundError } from '../../modules/scan/scan.errors.js';
import type {
  ScanCreateInput,
  PreparedScanCreateUpload,
  ScanCreateWithUploadsResult,
  ScanListOptions,
  ScanRecord,
  ScanRepository,
  ScanResult,
  ScanRole,
  ScanSort,
  ScanUpdateInput,
} from '../../modules/scan/scan.types.js';
import type { PrismaIdempotencyExecutor } from './prisma-idempotency.js';
import {
  refreshProjectRollup,
  resolveSyncConflict,
  upsertSyncConflict,
  writeAssetUpsert,
  writeDeleteChange,
  writeDeleteChangesBatch,
  writeScanUpsert,
} from './prisma-sync-writer.js';

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
} as const;

interface ScanRow {
  id: string;
  projectId: string;
  createdById: string;
  creator: {
    id: string;
    email: string | null;
  };
  name: string;
  description: string | null;
  thumbnail: string | null;
  assetStatus: ScanRecord['assetStatus'];
  syncStatus: ScanRecord['syncStatus'];
  modelVersion: number;
  revision: number;
  clientMutationId: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  _count: {
    notes: number;
  };
}

type SortDirection = 'asc' | 'desc';
type ScanOrderBy = {
  updatedAt?: SortDirection;
  createdAt?: SortDirection;
  name?: SortDirection;
  id?: SortDirection;
};

function toScanRecord(row: ScanRow): ScanRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    createdById: row.createdById,
    creator: row.creator,
    name: row.name,
    description: row.description,
    thumbnail: row.thumbnail,
    noteCount: row._count.notes,
    assetStatus: row.assetStatus,
    syncStatus: row.syncStatus,
    modelVersion: row.modelVersion,
    revision: row.revision,
    clientMutationId: row.clientMutationId,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toOwnerResult(record: ScanRecord): ScanResult {
  return {
    id: record.id,
    projectId: record.projectId,
    name: record.name,
    description: record.description,
    thumbnail: record.thumbnail,
    creator: record.creator,
    noteCount: record.noteCount,
    assetStatus: record.assetStatus,
    syncStatus: record.syncStatus,
    modelVersion: record.modelVersion,
    revision: record.revision ?? 1,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    permissions: { role: 'OWNER', canView: true, canEdit: true, canDelete: true },
  };
}

function orderByFor(sort: ScanSort): ScanOrderBy[] {
  const [field, direction] = sort.split(':') as ['updatedAt' | 'createdAt' | 'name', SortDirection];

  return [{ [field]: direction }, { id: direction }];
}

function viewableScanWhere(id: string, userId: string) {
  return {
    id,
    deletedAt: null,
    OR: [
      {
        project: {
          deletedAt: null,
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
        },
      },
      {
        project: { deletedAt: null },
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

export class PrismaScanRepository implements ScanRepository {
  readonly #client: Pick<PrismaClient, 'scan' | 'project' | '$transaction'>;
  readonly #idempotency: PrismaIdempotencyExecutor | undefined;

  constructor(
    client: Pick<PrismaClient, 'scan' | 'project' | '$transaction'>,
    idempotency?: PrismaIdempotencyExecutor,
  ) {
    this.#client = client;
    this.#idempotency = idempotency;
  }

  async createIdempotently(
    projectId: string,
    createdById: string,
    data: ScanCreateInput,
    context: IdempotencyContext,
  ): Promise<IdempotencyResult<ScanResult>> {
    if (this.#idempotency === undefined) throw new Error('Scan idempotency is not configured');
    try {
      return await this.#idempotency.execute(context, 201, async (transaction) => {
        const now = new Date();
        const row = await transaction.scan.create({
          data: {
            projectId,
            createdById,
            name: data.name,
            description: data.description,
            ...(data.clientMutationId === undefined
              ? {}
              : { clientMutationId: data.clientMutationId }),
            createdAt: now,
            updatedAt: now,
          },
          select: scanSelect,
        });
        await writeScanUpsert(transaction, row.id, { changedAt: now });
        await refreshProjectRollup(transaction, projectId, now);
        return toOwnerResult(toScanRecord(row));
      });
    } catch (error) {
      if (data.clientMutationId !== undefined && this.#isDuplicateMutationId(error)) {
        throw new IdempotencyKeyConflictError();
      }
      throw error;
    }
  }

  async createWithUploadsIdempotently(
    scanId: string,
    projectId: string,
    createdById: string,
    data: ScanCreateInput,
    uploads: PreparedScanCreateUpload[],
    context: IdempotencyContext,
  ): Promise<IdempotencyResult<ScanCreateWithUploadsResult>> {
    if (this.#idempotency === undefined) throw new Error('Scan idempotency is not configured');
    try {
      return await this.#idempotency.execute(context, 201, async (transaction) => {
        const now = new Date();
        const hasModel = uploads.some((upload) => upload.data.assetType === 'MODEL');
        const row = await transaction.scan.create({
          data: {
            id: scanId,
            projectId,
            createdById,
            name: data.name,
            description: data.description,
            ...(data.clientMutationId === undefined
              ? {}
              : { clientMutationId: data.clientMutationId }),
            assetStatus: hasModel ? 'PENDING' : 'NONE',
            syncStatus: 'PENDING',
            createdAt: now,
            updatedAt: now,
          },
          select: scanSelect,
        });

        for (const upload of uploads) {
          await transaction.scanAsset.create({
            data: {
              id: upload.data.id,
              scanId,
              assetType: upload.data.assetType,
              status: 'PENDING',
              contentType: upload.data.contentType,
              sizeBytes: upload.data.sizeBytes,
              checksum: upload.data.checksum,
              modelVersion: upload.data.modelVersion,
              storageKey: upload.data.storageKey,
              idempotencyKey: null,
              uploadUrlExpiresAt: upload.data.uploadUrlExpiresAt,
              createdAt: now,
              updatedAt: now,
            },
          });
          await writeAssetUpsert(transaction, upload.data.id, { changedAt: now });
        }

        await writeScanUpsert(transaction, row.id, { changedAt: now });
        await refreshProjectRollup(transaction, projectId, now);
        const uploadResponse: NonNullable<ScanCreateWithUploadsResult['uploads']> = {};
        for (const upload of uploads) {
          if (upload.data.assetType === 'THUMBNAIL') {
            uploadResponse.thumbnail = upload.response;
          } else {
            uploadResponse.scanFile = upload.response;
          }
        }
        return {
          ...toOwnerResult(toScanRecord(row)),
          ...(uploads.length === 0 ? {} : { uploads: uploadResponse }),
        };
      });
    } catch (error) {
      if (data.clientMutationId !== undefined && this.#isDuplicateMutationId(error)) {
        throw new IdempotencyKeyConflictError();
      }
      throw error;
    }
  }

  async create(
    projectId: string,
    createdById: string,
    data: ScanCreateInput,
  ): Promise<{ record: ScanRecord; created: boolean }> {
    if (data.clientMutationId !== undefined) {
      const existing = await this.#client.scan.findFirst({
        where: { projectId, clientMutationId: data.clientMutationId },
        select: { id: true, name: true, description: true, deletedAt: true },
      });

      if (existing !== null) {
        if (
          existing.deletedAt === null &&
          existing.name === data.name &&
          existing.description === data.description
        ) {
          const row = await this.#client.scan.findFirst({
            where: { id: existing.id },
            select: scanSelect,
          });

          if (row === null) {
            throw new ScanNotFoundError();
          }

          return { record: toScanRecord(row), created: false };
        }
        throw new IdempotencyKeyConflictError();
      }
    }

    try {
      return await this.#client.$transaction(async (transaction) => {
        const now = new Date();
        const row = await transaction.scan.create({
          data: {
            projectId,
            createdById,
            name: data.name,
            description: data.description,
            ...(data.clientMutationId === undefined
              ? {}
              : { clientMutationId: data.clientMutationId }),
            createdAt: now,
            updatedAt: now,
          },
          select: scanSelect,
        });
        await writeScanUpsert(transaction, row.id, { changedAt: now });
        await refreshProjectRollup(transaction, projectId, now);
        return { record: toScanRecord(row), created: true };
      });
    } catch (error) {
      if (this.#isDuplicateMutationId(error) && data.clientMutationId !== undefined) {
        const row = await this.#client.scan.findFirst({
          where: { projectId, clientMutationId: data.clientMutationId },
          select: scanSelect,
        });

        if (
          row !== null &&
          row.deletedAt === null &&
          row.name === data.name &&
          row.description === data.description
        ) {
          return { record: toScanRecord(row), created: false };
        }
        throw new IdempotencyKeyConflictError();
      }

      throw error;
    }
  }

  #isDuplicateMutationId(error: unknown): error is Prisma.PrismaClientKnownRequestError {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002' &&
      Array.isArray(error.meta?.target) &&
      error.meta.target.some((field) => ['projectId', 'clientMutationId'].includes(field as string))
    );
  }

  async listByProject(
    projectId: string,
    options: ScanListOptions,
  ): Promise<{ items: ScanRecord[]; total: number }> {
    const where = {
      projectId,
      deletedAt: null,
    };
    const [rows, total] = await this.#client.$transaction([
      this.#client.scan.findMany({
        where,
        orderBy: orderByFor(options.sort),
        skip: (options.page - 1) * options.limit,
        take: options.limit,
        select: scanSelect,
      }),
      this.#client.scan.count({ where }),
    ]);

    return {
      items: rows.map(toScanRecord),
      total,
    };
  }

  async findProjectId(id: string): Promise<string | null> {
    const row = await this.#client.scan.findFirst({
      where: { id, project: { deletedAt: null } },
      select: { projectId: true },
    });

    return row === null ? null : row.projectId;
  }

  async findAccessRole(id: string, userId: string): Promise<ScanRole | null> {
    const row = await this.#client.scan.findFirst({
      where: viewableScanWhere(id, userId),
      select: { project: { select: { ownerId: true } } },
    });

    if (row === null) {
      return null;
    }

    return row.project.ownerId === userId ? 'OWNER' : 'VIEWER';
  }

  async findByIdForUser(
    id: string,
    userId: string,
  ): Promise<{ record: ScanRecord; role: ScanRole } | null> {
    const row = await this.#client.scan.findFirst({
      where: viewableScanWhere(id, userId),
      select: {
        ...scanSelect,
        project: { select: { ownerId: true } },
      },
    });

    if (row === null) {
      return null;
    }

    const { project, ...recordRow } = row;
    return {
      record: toScanRecord(recordRow),
      role: project.ownerId === userId ? 'OWNER' : 'VIEWER',
    };
  }

  async update(
    id: string,
    ownerId: string,
    expectedRevisionOrData: number | ScanUpdateInput,
    maybeData?: ScanUpdateInput,
  ): Promise<ScanRecord> {
    const expectedRevision =
      typeof expectedRevisionOrData === 'number' ? expectedRevisionOrData : undefined;
    const data =
      typeof expectedRevisionOrData === 'number' ? (maybeData ?? {}) : expectedRevisionOrData;
    const outcome = await this.#client.$transaction(async (transaction) => {
      const changedAt = new Date();
      if (expectedRevision === undefined) {
        const result = await transaction.scan.updateMany({
          where: { id, deletedAt: null, project: { ownerId, deletedAt: null } },
          data,
        });
        if (result.count === 0) throw new ScanNotFoundError();
        const row = await transaction.scan.findFirst({
          where: { id, deletedAt: null, project: { ownerId, deletedAt: null } },
          select: scanSelect,
        });
        if (row === null) throw new ScanNotFoundError();
        return { kind: 'updated' as const, record: toScanRecord(row) };
      }
      const effectiveRevision = expectedRevision;
      const result = await transaction.scan.updateMany({
        where: {
          id,
          revision: effectiveRevision,
          deletedAt: null,
          project: { ownerId, deletedAt: null },
        },
        data: { ...data, revision: { increment: 1 }, updatedAt: changedAt },
      });

      if (result.count === 0) {
        const current = await transaction.scan.findFirst({
          where: { id, project: { ownerId } },
          select: { projectId: true, revision: true, deletedAt: true },
        });
        if (current === null) {
          throw new ScanNotFoundError();
        }
        const refreshChangeId =
          current.deletedAt === null
            ? await writeScanUpsert(transaction, id, {
                targetUserId: ownerId,
                syncStatus: 'CONFLICT',
                changedAt,
              })
            : await writeDeleteChange(transaction, {
                projectId: current.projectId,
                ownerId,
                targetUserId: ownerId,
                resourceType: 'SCAN',
                resourceId: id,
                revision: current.revision,
                deletedAt: current.deletedAt,
                syncStatus: 'CONFLICT',
              });
        await upsertSyncConflict(transaction, {
          userId: ownerId,
          projectId: current.projectId,
          resourceType: 'SCAN',
          resourceId: id,
          serverRevision: current.revision,
          refreshChangeId,
        });
        return { kind: 'conflict' as const, current };
      }

      const row = await transaction.scan.findFirst({
        where: { id, deletedAt: null, project: { ownerId, deletedAt: null } },
        select: scanSelect,
      });

      if (row === null) {
        throw new ScanNotFoundError();
      }

      await resolveSyncConflict(transaction, ownerId, 'SCAN', id, changedAt);
      await writeScanUpsert(transaction, id, { changedAt });
      await refreshProjectRollup(transaction, row.projectId, changedAt);
      return { kind: 'updated' as const, record: toScanRecord(row) };
    });

    if (outcome.kind === 'conflict') {
      throw new RevisionConflictError({
        projectId: outcome.current.projectId,
        resourceType: 'SCAN',
        resourceId: id,
        currentRevision: outcome.current.revision,
        deleted: outcome.current.deletedAt !== null,
      });
    }
    return outcome.record;
  }

  async softDelete(
    id: string,
    ownerId: string,
    expectedRevision?: number,
  ): Promise<number | undefined> {
    const outcome = await this.#client.$transaction(async (transaction) => {
      const scan = await transaction.scan.findFirst({
        where: { id, project: { ownerId } },
        select: {
          id: true,
          projectId: true,
          revision: true,
          deletedAt: true,
          notes: { where: { deletedAt: null }, select: { id: true, revision: true } },
          assets: { where: { deletedAt: null }, select: { id: true, revision: true } },
        },
      });

      if (scan === null) {
        throw new ScanNotFoundError();
      }

      if (scan.revision === undefined) {
        if (scan.deletedAt !== null) return { kind: 'deleted' as const, revision: undefined };
        const deletedAt = new Date();
        await transaction.scan.update({ where: { id }, data: { deletedAt } });
        await transaction.project.update({
          where: { id: scan.projectId },
          data: { updatedAt: deletedAt },
        });
        return { kind: 'deleted' as const, revision: undefined };
      }

      if (scan.deletedAt !== null) {
        return { kind: 'deleted' as const, revision: scan.revision };
      }

      const deletedAt = new Date();
      if (expectedRevision !== undefined && scan.revision !== expectedRevision) {
        const refreshChangeId = await writeScanUpsert(transaction, id, {
          targetUserId: ownerId,
          syncStatus: 'CONFLICT',
          changedAt: deletedAt,
        });
        await upsertSyncConflict(transaction, {
          userId: ownerId,
          projectId: scan.projectId,
          resourceType: 'SCAN',
          resourceId: id,
          serverRevision: scan.revision,
          refreshChangeId,
        });
        return { kind: 'conflict' as const, revision: scan.revision, projectId: scan.projectId };
      }
      if (expectedRevision !== undefined) {
        const claimed = await transaction.scan.updateMany({
          where: {
            id,
            revision: expectedRevision,
            deletedAt: null,
            project: { ownerId },
          },
          data: { deletedAt, revision: { increment: 1 }, updatedAt: deletedAt },
        });
        if (claimed.count === 0) {
          const current = await transaction.scan.findFirst({
            where: { id, project: { ownerId } },
            select: { projectId: true, revision: true, deletedAt: true },
          });
          if (current === null) throw new ScanNotFoundError();
          if (current.deletedAt !== null) {
            return { kind: 'deleted' as const, revision: current.revision };
          }
          const refreshChangeId = await writeScanUpsert(transaction, id, {
            targetUserId: ownerId,
            syncStatus: 'CONFLICT',
            changedAt: deletedAt,
          });
          await upsertSyncConflict(transaction, {
            userId: ownerId,
            projectId: current.projectId,
            resourceType: 'SCAN',
            resourceId: id,
            serverRevision: current.revision,
            refreshChangeId,
          });
          return {
            kind: 'conflict' as const,
            revision: current.revision,
            projectId: current.projectId,
          };
        }
      } else {
        await transaction.scan.update({
          where: { id },
          data: { deletedAt, revision: { increment: 1 }, updatedAt: deletedAt },
        });
      }
      const notes = scan.notes ?? [];
      if (notes.length > 0) {
        await transaction.note.updateMany({
          where: { id: { in: notes.map((note) => note.id) } },
          data: { deletedAt, revision: { increment: 1 }, updatedAt: deletedAt },
        });
        await writeDeleteChangesBatch(
          transaction,
          notes.map((note) => ({
            projectId: scan.projectId,
            ownerId,
            resourceType: 'NOTE',
            resourceId: note.id,
            revision: note.revision + 1,
            deletedAt,
          })),
        );
      }
      const assets = scan.assets ?? [];
      if (assets.length > 0) {
        await transaction.scanAsset.updateMany({
          where: { id: { in: assets.map((asset) => asset.id) } },
          data: { deletedAt, revision: { increment: 1 }, updatedAt: deletedAt },
        });
        await writeDeleteChangesBatch(
          transaction,
          assets.map((asset) => ({
            projectId: scan.projectId,
            ownerId,
            resourceType: 'SCAN_ASSET',
            resourceId: asset.id,
            revision: asset.revision + 1,
            deletedAt,
          })),
        );
      }
      await writeDeleteChange(transaction, {
        projectId: scan.projectId,
        ownerId,
        resourceType: 'SCAN',
        resourceId: id,
        revision: scan.revision + 1,
        deletedAt,
      });
      await resolveSyncConflict(transaction, ownerId, 'SCAN', id, deletedAt);
      await refreshProjectRollup(transaction, scan.projectId, deletedAt);
      return { kind: 'deleted' as const, revision: scan.revision + 1 };
    });

    if (outcome.kind === 'conflict') {
      throw new RevisionConflictError({
        projectId: outcome.projectId,
        resourceType: 'SCAN',
        resourceId: id,
        currentRevision: outcome.revision,
        deleted: false,
      });
    }
    return outcome.revision;
  }

  async updateAssetStatus(
    scanId: string,
    data: { assetStatus?: ScanRecord['assetStatus']; syncStatus?: ScanRecord['syncStatus'] },
  ): Promise<void> {
    if (this.#idempotency === undefined) {
      await this.#client.scan.updateMany({ where: { id: scanId, deletedAt: null }, data });
      return;
    }
    await this.#client.$transaction(async (transaction) => {
      const changedAt = new Date();
      const result = await transaction.scan.updateMany({
        where: {
          id: scanId,
          deletedAt: null,
          OR: [
            ...(data.assetStatus === undefined ? [] : [{ assetStatus: { not: data.assetStatus } }]),
            ...(data.syncStatus === undefined ? [] : [{ syncStatus: { not: data.syncStatus } }]),
          ],
        },
        data: { ...data, revision: { increment: 1 }, updatedAt: changedAt },
      });
      if (result.count > 0) {
        await writeScanUpsert(transaction, scanId, { changedAt });
        const scan = await transaction.scan.findUniqueOrThrow({
          where: { id: scanId },
          select: { projectId: true },
        });
        await refreshProjectRollup(transaction, scan.projectId, changedAt);
      }
    });
  }

  async updateThumbnail(scanId: string, thumbnail: string | null): Promise<void> {
    if (this.#idempotency === undefined) {
      await this.#client.scan.updateMany({
        where: { id: scanId, deletedAt: null },
        data: { thumbnail },
      });
      return;
    }
    await this.#client.$transaction(async (transaction) => {
      const changedAt = new Date();
      const result = await transaction.scan.updateMany({
        where: { id: scanId, deletedAt: null, thumbnail: { not: thumbnail } },
        data: { thumbnail, revision: { increment: 1 }, updatedAt: changedAt },
      });
      if (result.count > 0) {
        await writeScanUpsert(transaction, scanId, { changedAt });
        const scan = await transaction.scan.findUniqueOrThrow({
          where: { id: scanId },
          select: { projectId: true },
        });
        await refreshProjectRollup(transaction, scan.projectId, changedAt);
      }
    });
  }
}
