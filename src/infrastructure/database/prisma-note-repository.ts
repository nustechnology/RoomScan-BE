import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { ProjectRole as PrismaProjectRole } from '../../generated/prisma/enums.js';
import { NoteNotFoundError } from '../../modules/note/note.errors.js';
import type {
  NoteCreateInput,
  NoteListOptions,
  NotePositionUpdateInput,
  NoteRecord,
  NoteRepository,
  NoteRole,
  NoteScanContext,
  NoteUpdateInput,
  Vector3,
} from '../../modules/note/note.types.js';

function parseVector3(value: Prisma.JsonValue): Vector3 {
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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
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

  constructor(client: Pick<PrismaClient, 'note' | 'scan' | 'project' | '$transaction'>) {
    this.#client = client;
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

  async create(scanId: string, createdById: string, data: NoteCreateInput): Promise<NoteRecord> {
    return await this.#client.$transaction(async (transaction) => {
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
        },
        select: noteSelect,
      });

      await this.#touchActivity(transaction, scanId, row.createdAt);

      return toNoteRecord(row);
    });
  }

  async listByScan(
    scanId: string,
    options: NoteListOptions,
  ): Promise<{ items: NoteRecord[]; total: number }> {
    const where = {
      scanId,
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

  async update(noteId: string, ownerId: string, data: NoteUpdateInput): Promise<NoteRecord> {
    return await this.#client.$transaction(async (transaction) => {
      const note = await this.#findOwnedNote(transaction, noteId, ownerId);

      if (note === null) {
        throw new NoteNotFoundError();
      }

      const row = await transaction.note.update({
        where: { id: noteId },
        data,
        select: noteSelect,
      });

      await this.#touchActivity(transaction, note.scanId, row.updatedAt);

      return toNoteRecord(row);
    });
  }

  async updatePosition(
    noteId: string,
    ownerId: string,
    data: NotePositionUpdateInput,
  ): Promise<NoteRecord> {
    return await this.#client.$transaction(async (transaction) => {
      const note = await this.#findOwnedNote(transaction, noteId, ownerId);

      if (note === null) {
        throw new NoteNotFoundError();
      }

      const row = await transaction.note.update({
        where: { id: noteId },
        data: {
          position: data.position as unknown as Prisma.InputJsonValue,
          orientation:
            data.orientation === null
              ? Prisma.JsonNull
              : (data.orientation as unknown as Prisma.InputJsonValue),
          modelVersion: data.modelVersion,
        },
        select: noteSelect,
      });

      await this.#touchActivity(transaction, note.scanId, row.updatedAt);

      return toNoteRecord(row);
    });
  }

  async delete(noteId: string, ownerId: string): Promise<void> {
    await this.#client.$transaction(async (transaction) => {
      const note = await this.#findOwnedNote(transaction, noteId, ownerId);

      if (note === null) {
        throw new NoteNotFoundError();
      }

      const deletedAt = new Date();
      await transaction.note.delete({ where: { id: noteId } });
      await this.#touchActivity(transaction, note.scanId, deletedAt);
    });
  }

  async #findOwnedNote(
    transaction: NoteTransactionClient,
    noteId: string,
    ownerId: string,
  ): Promise<{ scanId: string } | null> {
    return await transaction.note.findFirst({
      where: {
        id: noteId,
        scan: {
          deletedAt: null,
          project: { ownerId, deletedAt: null },
        },
      },
      select: { scanId: true },
    });
  }

  async #touchActivity(
    transaction: NoteTransactionClient,
    scanId: string,
    at: Date,
  ): Promise<void> {
    const scan = await transaction.scan.findFirst({
      where: { id: scanId },
      select: { projectId: true },
    });

    if (scan === null) {
      return;
    }

    await transaction.scan.update({
      where: { id: scanId },
      data: { updatedAt: at },
    });
    await transaction.project.update({
      where: { id: scan.projectId },
      data: { updatedAt: at },
    });
  }
}
