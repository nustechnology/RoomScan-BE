import type { PrismaClient } from '../../generated/prisma/client.js';
import { ProjectRole as PrismaProjectRole } from '../../generated/prisma/enums.js';
import { ScanNotFoundError } from '../../modules/scan/scan.errors.js';
import type {
  ScanCreateInput,
  ScanListOptions,
  ScanRecord,
  ScanRepository,
  ScanRole,
  ScanSort,
  ScanUpdateInput,
} from '../../modules/scan/scan.types.js';

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
  clientMutationId: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
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
  clientMutationId: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
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
    noteCount: 0,
    assetStatus: row.assetStatus,
    syncStatus: row.syncStatus,
    modelVersion: row.modelVersion,
    clientMutationId: row.clientMutationId,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
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
  };
}

export class PrismaScanRepository implements ScanRepository {
  readonly #client: Pick<PrismaClient, 'scan' | 'project' | '$transaction'>;

  constructor(client: Pick<PrismaClient, 'scan' | 'project' | '$transaction'>) {
    this.#client = client;
  }

  async create(projectId: string, createdById: string, data: ScanCreateInput): Promise<ScanRecord> {
    if (data.clientMutationId !== undefined) {
      const existing = await this.#client.scan.findFirst({
        where: { clientMutationId: data.clientMutationId, project: { deletedAt: null } },
        select: { id: true, deletedAt: true },
      });

      if (existing !== null) {
        return await this.#client.$transaction(async (transaction) => {
          if (existing.deletedAt !== null) {
            await transaction.scan.update({
              where: { id: existing.id },
              data: { deletedAt: null },
            });
          }

          const row = await transaction.scan.findFirst({
            where: { id: existing.id },
            select: scanSelect,
          });

          if (row === null) {
            throw new ScanNotFoundError();
          }

          return toScanRecord(row);
        });
      }
    }

    const row = await this.#client.scan.create({
      data: {
        projectId,
        createdById,
        name: data.name,
        description: data.description,
        ...(data.clientMutationId === undefined ? {} : { clientMutationId: data.clientMutationId }),
      },
      select: scanSelect,
    });

    return toScanRecord(row);
  }

  async findByClientMutationId(clientMutationId: string): Promise<ScanRecord | null> {
    const row = await this.#client.scan.findFirst({
      where: { clientMutationId, project: { deletedAt: null } },
      select: scanSelect,
    });

    return row === null ? null : toScanRecord(row);
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

  async update(id: string, ownerId: string, data: ScanUpdateInput): Promise<ScanRecord> {
    return await this.#client.$transaction(async (transaction) => {
      const result = await transaction.scan.updateMany({
        where: { id, deletedAt: null, project: { ownerId, deletedAt: null } },
        data,
      });

      if (result.count === 0) {
        throw new ScanNotFoundError();
      }

      const row = await transaction.scan.findFirst({
        where: { id, deletedAt: null, project: { ownerId, deletedAt: null } },
        select: scanSelect,
      });

      if (row === null) {
        throw new ScanNotFoundError();
      }

      return toScanRecord(row);
    });
  }

  async softDelete(id: string, ownerId: string): Promise<void> {
    await this.#client.$transaction(async (transaction) => {
      const scan = await transaction.scan.findFirst({
        where: { id, project: { ownerId, deletedAt: null } },
        select: { id: true, projectId: true, deletedAt: true },
      });

      if (scan === null) {
        throw new ScanNotFoundError();
      }

      if (scan.deletedAt !== null) {
        return;
      }

      const deletedAt = new Date();
      await transaction.scan.update({
        where: { id },
        data: { deletedAt },
      });
      await transaction.project.update({
        where: { id: scan.projectId },
        data: { updatedAt: deletedAt },
      });
    });
  }
}
