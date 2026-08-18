import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { ProjectRole as PrismaProjectRole } from '../../generated/prisma/enums.js';
import type {
  IdempotencyContext,
  IdempotencyResult,
} from '../../common/idempotency/idempotency.types.js';
import { RevisionConflictError } from '../../common/revision/revision.errors.js';
import { NoteNotFoundError } from '../../modules/note/note.errors.js';
import type {
  NoteCreateInput,
  NoteListOptions,
  NotePositionUpdateInput,
  NoteRecord,
  NoteRepository,
  NoteResult,
  NoteRole,
  NoteScanContext,
  NoteUpdateInput,
  Vector3,
} from '../../modules/note/note.types.js';
import type { PrismaIdempotencyExecutor } from './prisma-idempotency.js';
import {
  refreshScanRollup,
  resolveSyncConflict,
  upsertSyncConflict,
  writeDeleteChange,
  writeNoteUpsert,
} from './prisma-sync-writer.js';

function parseVector3(value: Prisma.JsonValue): Vector3 {
  if (value === null) {
    throw new Error('Stored note position is not a valid vector');
  }

  const parsed = value as Record<string, unknown>;
  const x = parsed['x'];
  const y = parsed['y'];
  const z = parsed['z'];

  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof z !== 'number' ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(z)
  ) {
    throw new Error('Stored note position is not a valid vector');
  }

  return { x, y, z };
}

const noteSelect = {
  id: true,
  scanId: true,
  createdById: true,
  creator: {
    select: {
      id: true,
      email: true,
    },
  },
  content: true,
  color: true,
  position: true,
  orientation: true,
  modelVersion: true,
  revision: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

type NoteRow = {
  id: string;
  scanId: string;
  createdById: string;
  creator: {
    id: string;
    email: string | null;
  };
  content: string;
  color: NoteRecord['color'];
  position: Prisma.JsonValue;
  orientation: Prisma.JsonValue;
  modelVersion: string;
  revision: number;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toNoteRecord(row: NoteRow): NoteRecord {
  return {
    id: row.id,
    scanId: row.scanId,
    createdById: row.createdById,
    creator: row.creator,
    content: row.content,
    color: row.color,
    position: parseVector3(row.position),
    orientation: row.orientation === null ? null : parseVector3(row.orientation),
    modelVersion: row.modelVersion,
    revision: row.revision,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toOwnerResult(record: NoteRecord): NoteResult {
  return {
    id: record.id,
    scanId: record.scanId,
    content: record.content,
    color: record.color,
    position: record.position,
    orientation: record.orientation,
    modelVersion: record.modelVersion,
    revision: record.revision ?? 1,
    creator: record.creator,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    permissions: {
      role: 'OWNER',
      canView: true,
      canEdit: true,
      canDelete: true,
    },
  };
}

type SortDirection = 'asc' | 'desc';
type NoteOrderBy = {
  updatedAt?: SortDirection;
  createdAt?: SortDirection;
  id?: SortDirection;
};

function orderByFor(sort: NoteListOptions['sort']): NoteOrderBy[] {
  const [field, direction] = sort.split(':') as ['updatedAt' | 'createdAt', SortDirection];

  return [{ [field]: direction }, { id: direction }];
}

function viewableNoteWhere(noteId: string, userId: string) {
  return {
    id: noteId,
    deletedAt: null,
    scan: {
      deletedAt: null,
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
  };
}

type NoteTransactionClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

export class PrismaNoteRepository implements NoteRepository {
  readonly #client: Pick<PrismaClient, 'note' | 'scan' | 'project' | '$transaction'>;
  readonly #idempotency: PrismaIdempotencyExecutor | undefined;

  constructor(
    client: Pick<PrismaClient, 'note' | 'scan' | 'project' | '$transaction'>,
    idempotency?: PrismaIdempotencyExecutor,
  ) {
    this.#client = client;
    this.#idempotency = idempotency;
  }

  async findScanContext(scanId: string): Promise<NoteScanContext | null> {
    const row = await this.#client.scan.findFirst({
      where: { id: scanId, deletedAt: null, project: { deletedAt: null } },
      select: { projectId: true, modelVersion: true },
    });

    return row === null ? null : { projectId: row.projectId, modelVersion: row.modelVersion };
  }

  async findNoteContext(noteId: string): Promise<NoteScanContext | null> {
    const row = await this.#client.note.findFirst({
      where: {
        id: noteId,
        scan: {
          deletedAt: null,
          project: { deletedAt: null },
        },
      },
      select: {
        scan: {
          select: {
            projectId: true,
            modelVersion: true,
          },
        },
      },
    });

    if (row === null) {
      return null;
    }

    return { projectId: row.scan.projectId, modelVersion: row.scan.modelVersion };
  }

  async findOwnedMutationContext(noteId: string, ownerId: string): Promise<NoteScanContext | null> {
    const row = await this.#client.note.findFirst({
      where: { id: noteId, scan: { project: { ownerId } } },
      select: { scan: { select: { projectId: true, modelVersion: true } } },
    });

    return row === null
      ? null
      : { projectId: row.scan.projectId, modelVersion: row.scan.modelVersion };
  }

  async create(scanId: string, createdById: string, data: NoteCreateInput): Promise<NoteRecord> {
    return await this.#client.$transaction(async (transaction) => {
      const now = new Date();
      const row = await transaction.note.create({
        data: {
          scanId,
          createdById,
          content: data.content,
          color: data.color,
          position: data.position as unknown as Prisma.InputJsonValue,
          orientation:
            data.orientation === null
              ? Prisma.JsonNull
              : (data.orientation as unknown as Prisma.InputJsonValue),
          modelVersion: data.modelVersion,
          createdAt: now,
          updatedAt: now,
        },
        select: noteSelect,
      });

      await writeNoteUpsert(transaction, row.id, { changedAt: now });
      await refreshScanRollup(transaction, scanId, now);

      return toNoteRecord(row);
    });
  }

  async createIdempotently(
    scanId: string,
    createdById: string,
    data: NoteCreateInput,
    context: IdempotencyContext,
  ): Promise<IdempotencyResult<NoteResult>> {
    if (this.#idempotency === undefined) throw new Error('Note idempotency is not configured');
    return await this.#idempotency.execute(context, 201, async (transaction) => {
      const now = new Date();
      const row = await transaction.note.create({
        data: {
          scanId,
          createdById,
          content: data.content,
          color: data.color,
          position: data.position as unknown as Prisma.InputJsonValue,
          orientation:
            data.orientation === null
              ? Prisma.JsonNull
              : (data.orientation as unknown as Prisma.InputJsonValue),
          modelVersion: data.modelVersion,
          createdAt: now,
          updatedAt: now,
        },
        select: noteSelect,
      });
      await writeNoteUpsert(transaction, row.id, { changedAt: now });
      await refreshScanRollup(transaction, scanId, now);
      return toOwnerResult(toNoteRecord(row));
    });
  }

  async listByScan(
    scanId: string,
    options: NoteListOptions,
  ): Promise<{ items: NoteRecord[]; total: number }> {
    const where = {
      scanId,
      deletedAt: null,
      scan: {
        deletedAt: null,
      },
    };
    const [rows, total] = await this.#client.$transaction([
      this.#client.note.findMany({
        where,
        orderBy: orderByFor(options.sort),
        skip: (options.page - 1) * options.limit,
        take: options.limit,
        select: noteSelect,
      }),
      this.#client.note.count({ where }),
    ]);

    return {
      items: rows.map(toNoteRecord),
      total,
    };
  }

  async findByIdForUser(
    noteId: string,
    userId: string,
  ): Promise<{ record: NoteRecord; role: NoteRole } | null> {
    const row = await this.#client.note.findFirst({
      where: viewableNoteWhere(noteId, userId),
      select: {
        ...noteSelect,
        scan: { select: { project: { select: { ownerId: true } } } },
      },
    });

    if (row === null) {
      return null;
    }

    const { scan, ...recordRow } = row;
    return {
      record: toNoteRecord(recordRow),
      role: scan.project.ownerId === userId ? 'OWNER' : 'VIEWER',
    };
  }

  async update(
    noteId: string,
    ownerId: string,
    expectedRevisionOrData: number | NoteUpdateInput,
    maybeData?: NoteUpdateInput,
  ): Promise<NoteRecord> {
    const expected =
      typeof expectedRevisionOrData === 'number' ? expectedRevisionOrData : undefined;
    const data =
      typeof expectedRevisionOrData === 'number' ? (maybeData ?? {}) : expectedRevisionOrData;
    return await this.#updateOwned(noteId, ownerId, expected, data);
  }

  async updatePosition(
    noteId: string,
    ownerId: string,
    expectedRevisionOrData: number | NotePositionUpdateInput,
    maybeData?: NotePositionUpdateInput,
  ): Promise<NoteRecord> {
    const expected =
      typeof expectedRevisionOrData === 'number' ? expectedRevisionOrData : undefined;
    const input =
      typeof expectedRevisionOrData === 'number'
        ? (maybeData as NotePositionUpdateInput)
        : expectedRevisionOrData;
    return await this.#updateOwned(noteId, ownerId, expected, {
      position: input.position as unknown as Prisma.InputJsonValue,
      orientation:
        input.orientation === null
          ? Prisma.JsonNull
          : (input.orientation as unknown as Prisma.InputJsonValue),
      modelVersion: input.modelVersion,
    });
  }

  async delete(
    noteId: string,
    ownerId: string,
    expectedRevision?: number,
  ): Promise<number | undefined> {
    const outcome = await this.#client.$transaction(async (transaction) => {
      const note = await this.#findOwnedNote(transaction, noteId, ownerId);

      if (note === null) {
        throw new NoteNotFoundError();
      }

      if (note.deletedAt !== null) return { kind: 'deleted' as const, revision: note.revision };
      const deletedAt = new Date();
      if (this.#idempotency === undefined) {
        await transaction.note.update({
          where: { id: noteId },
          data: { deletedAt, revision: { increment: 1 }, updatedAt: deletedAt },
        });
        await writeDeleteChange(transaction, {
          projectId: note.projectId,
          ownerId,
          resourceType: 'NOTE',
          resourceId: noteId,
          revision: note.revision + 1,
          deletedAt,
        });
        await resolveSyncConflict(transaction, ownerId, 'NOTE', noteId, deletedAt);
        await refreshScanRollup(transaction, note.scanId, deletedAt);
        return { kind: 'deleted' as const, revision: note.revision + 1 };
      }
      if (expectedRevision !== undefined && expectedRevision !== note.revision) {
        const refreshChangeId = await writeNoteUpsert(transaction, noteId, {
          targetUserId: ownerId,
          syncStatus: 'CONFLICT',
          changedAt: deletedAt,
        });
        await upsertSyncConflict(transaction, {
          userId: ownerId,
          projectId: note.projectId,
          resourceType: 'NOTE',
          resourceId: noteId,
          serverRevision: note.revision,
          refreshChangeId,
        });
        return { kind: 'conflict' as const, revision: note.revision, projectId: note.projectId };
      }
      if (expectedRevision !== undefined) {
        const claimed = await transaction.note.updateMany({
          where: {
            id: noteId,
            revision: expectedRevision,
            deletedAt: null,
            scan: { project: { ownerId } },
          },
          data: { deletedAt, revision: { increment: 1 }, updatedAt: deletedAt },
        });
        if (claimed.count === 0) {
          const current = await this.#findOwnedNote(transaction, noteId, ownerId);
          if (current === null) throw new NoteNotFoundError();
          if (current.deletedAt !== null) {
            return { kind: 'deleted' as const, revision: current.revision };
          }
          const refreshChangeId = await writeNoteUpsert(transaction, noteId, {
            targetUserId: ownerId,
            syncStatus: 'CONFLICT',
            changedAt: deletedAt,
          });
          await upsertSyncConflict(transaction, {
            userId: ownerId,
            projectId: current.projectId,
            resourceType: 'NOTE',
            resourceId: noteId,
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
        await transaction.note.update({
          where: { id: noteId },
          data: { deletedAt, revision: { increment: 1 }, updatedAt: deletedAt },
        });
      }
      await writeDeleteChange(transaction, {
        projectId: note.projectId,
        ownerId,
        resourceType: 'NOTE',
        resourceId: noteId,
        revision: note.revision + 1,
        deletedAt,
      });
      await resolveSyncConflict(transaction, ownerId, 'NOTE', noteId, deletedAt);
      await refreshScanRollup(transaction, note.scanId, deletedAt);
      return { kind: 'deleted' as const, revision: note.revision + 1 };
    });
    if (outcome.kind === 'conflict') {
      throw new RevisionConflictError({
        projectId: outcome.projectId,
        resourceType: 'NOTE',
        resourceId: noteId,
        currentRevision: outcome.revision,
        deleted: false,
      });
    }
    return outcome.revision;
  }

  async #updateOwned(
    noteId: string,
    ownerId: string,
    expectedRevision: number | undefined,
    data: Prisma.NoteUpdateManyMutationInput,
  ): Promise<NoteRecord> {
    const outcome = await this.#client.$transaction(async (transaction) => {
      const changedAt = new Date();
      const current = await this.#findOwnedNote(transaction, noteId, ownerId);
      if (current === null) throw new NoteNotFoundError();
      if (expectedRevision === undefined && this.#idempotency === undefined) {
        const row = await transaction.note.update({
          where: { id: noteId },
          data,
          select: noteSelect,
        });
        await refreshScanRollup(transaction, row.scanId, changedAt);
        return { kind: 'updated' as const, record: toNoteRecord(row) };
      }
      const effectiveRevision = expectedRevision ?? current.revision;
      const result = await transaction.note.updateMany({
        where: {
          id: noteId,
          revision: effectiveRevision,
          deletedAt: null,
          scan: { deletedAt: null, project: { ownerId, deletedAt: null } },
        },
        data: { ...data, revision: { increment: 1 }, updatedAt: changedAt },
      });

      if (result.count === 0) {
        const refreshChangeId =
          current.deletedAt === null
            ? await writeNoteUpsert(transaction, noteId, {
                targetUserId: ownerId,
                syncStatus: 'CONFLICT',
                changedAt,
              })
            : await writeDeleteChange(transaction, {
                projectId: current.projectId,
                ownerId,
                targetUserId: ownerId,
                resourceType: 'NOTE',
                resourceId: noteId,
                revision: current.revision,
                deletedAt: current.deletedAt,
                syncStatus: 'CONFLICT',
              });
        await upsertSyncConflict(transaction, {
          userId: ownerId,
          projectId: current.projectId,
          resourceType: 'NOTE',
          resourceId: noteId,
          serverRevision: current.revision,
          refreshChangeId,
        });
        return { kind: 'conflict' as const, current };
      }

      const row = await transaction.note.findUniqueOrThrow({
        where: { id: noteId },
        select: noteSelect,
      });
      await resolveSyncConflict(transaction, ownerId, 'NOTE', noteId, changedAt);
      await writeNoteUpsert(transaction, noteId, { changedAt });
      await refreshScanRollup(transaction, row.scanId, changedAt);
      return { kind: 'updated' as const, record: toNoteRecord(row) };
    });

    if (outcome.kind === 'conflict') {
      throw new RevisionConflictError({
        projectId: outcome.current.projectId,
        resourceType: 'NOTE',
        resourceId: noteId,
        currentRevision: outcome.current.revision,
        deleted: outcome.current.deletedAt !== null,
      });
    }
    return outcome.record;
  }

  async #findOwnedNote(
    transaction: NoteTransactionClient,
    noteId: string,
    ownerId: string,
  ): Promise<{
    scanId: string;
    projectId: string;
    revision: number;
    deletedAt: Date | null;
  } | null> {
    const row = await transaction.note.findFirst({
      where: {
        id: noteId,
        scan: {
          project: { ownerId },
        },
      },
      select: {
        scanId: true,
        revision: true,
        deletedAt: true,
        scan: { select: { projectId: true } },
      },
    });
    if (row === null) return null;
    const legacy = row as unknown as {
      scanId: string;
      revision?: number;
      deletedAt?: Date | null;
      scan?: { projectId: string };
    };
    return {
      scanId: legacy.scanId,
      projectId: legacy.scan?.projectId ?? '',
      revision: legacy.revision ?? 1,
      deletedAt: legacy.deletedAt ?? null,
    };
  }
}
