import type { PrismaClient } from '../../generated/prisma/client.js';
import { ProjectRole as PrismaProjectRole } from '../../generated/prisma/enums.js';
import { ProjectNotFoundError } from '../../modules/project/project.errors.js';
import type {
  ProjectCreateInput,
  ProjectListOptions,
  ProjectRecord,
  ProjectRepository,
  ProjectRole,
  ProjectSort,
  ProjectUpdateInput,
} from '../../modules/project/project.types.js';

const projectSelect = {
  id: true,
  name: true,
  description: true,
  ownerId: true,
  owner: {
    select: {
      id: true,
      email: true,
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
          notes: true,
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
  owner: {
    id: string;
    email: string | null;
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
    syncStatus: null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
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
          },
        },
      },
    ],
  };
}

export class PrismaProjectRepository implements ProjectRepository {
  readonly #client: Pick<PrismaClient, 'project' | '$transaction'>;

  constructor(client: Pick<PrismaClient, 'project' | '$transaction'>) {
    this.#client = client;
  }

  async create(ownerId: string, data: ProjectCreateInput): Promise<ProjectRecord> {
    const row = await this.#client.project.create({
      data: {
        ownerId,
        name: data.name,
        description: data.description,
      },
      select: projectSelect,
    });

    return toProjectRecord(row);
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

  async update(id: string, ownerId: string, data: ProjectUpdateInput): Promise<ProjectRecord> {
    return await this.#client.$transaction(async (transaction) => {
      const result = await transaction.project.updateMany({
        where: { id, ownerId, deletedAt: null },
        data,
      });

      if (result.count === 0) {
        throw new ProjectNotFoundError();
      }

      const row = await transaction.project.findFirst({
        where: { id, ownerId, deletedAt: null },
        select: projectSelect,
      });

      if (row === null) {
        throw new ProjectNotFoundError();
      }

      return toProjectRecord(row);
    });
  }

  async softDelete(id: string, ownerId: string): Promise<void> {
    await this.#client.$transaction(async (transaction) => {
      const project = await transaction.project.findFirst({
        where: { id, ownerId },
        select: { deletedAt: true },
      });

      if (project === null) {
        throw new ProjectNotFoundError();
      }

      if (project.deletedAt !== null) {
        return;
      }

      const deletedAt = new Date();
      await transaction.project.update({
        where: { id },
        data: { deletedAt },
      });
      await transaction.projectAccess.updateMany({
        where: {
          projectId: id,
          revokedAt: null,
        },
        data: { revokedAt: deletedAt },
      });
    });
  }
}
