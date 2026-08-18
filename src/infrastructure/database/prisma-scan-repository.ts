import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
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
  _count: {
    select: {
      notes: true,
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

  constructor(client: Pick<PrismaClient, 'scan' | 'project' | '$transaction'>) {
    this.#client = client;
  }

  async create(
    projectId: string,
    createdById: string,
    data: ScanCreateInput,
  ): Promise<{ record: ScanRecord; created: boolean }> {
    if (data.clientMutationId !== undefined) {
      const existing = await this.#client.scan.findFirst({
        where: { projectId, clientMutationId: data.clientMutationId },
        select: { id: true, deletedAt: true },
      });

      if (existing !== null) {
        if (existing.deletedAt === null) {
          const row = await this.#client.scan.findFirst({
            where: { id: existing.id },
            select: scanSelect,
          });

          if (row === null) {
            throw new ScanNotFoundError();
          }

          return { record: toScanRecord(row), created: false };
        }

        return await this.#client.$transaction(async (transaction) => {
          await transaction.scan.update({
            where: { id: existing.id },
            data: { deletedAt: null, name: data.name, description: data.description },
          });

          const row = await transaction.scan.findFirst({
            where: { id: existing.id },
            select: scanSelect,
          });

          if (row === null) {
            throw new ScanNotFoundError();
          }

          return { record: toScanRecord(row), created: false };
        });
      }
    }

    try {
      const row = await this.#client.scan.create({
        data: {
          projectId,
          createdById,
          name: data.name,
          description: data.description,
          ...(data.clientMutationId === undefined
            ? {}
            : { clientMutationId: data.clientMutationId }),
        },
        select: scanSelect,
      });

      return { record: toScanRecord(row), created: true };
    } catch (error) {
      if (this.#isDuplicateMutationId(error) && data.clientMutationId !== undefined) {
        const row = await this.#client.scan.findFirst({
          where: { projectId, clientMutationId: data.clientMutationId },
          select: scanSelect,
        });

        if (row !== null) {
          return { record: toScanRecord(row), created: false };
        }
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

  async updateAssetStatus(
    scanId: string,
    data: { assetStatus?: ScanRecord['assetStatus']; syncStatus?: ScanRecord['syncStatus'] },
  ): Promise<void> {
    await this.#client.scan.updateMany({
      where: { id: scanId, deletedAt: null },
      data,
    });
  }

  async updateThumbnail(scanId: string, thumbnail: string | null): Promise<void> {
    await this.#client.scan.updateMany({
      where: { id: scanId, deletedAt: null },
      data: { thumbnail },
    });
  }
}
