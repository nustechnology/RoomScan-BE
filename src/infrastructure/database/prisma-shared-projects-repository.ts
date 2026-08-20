import type { PrismaClient } from '../../generated/prisma/client.js';
import { ProjectRole as PrismaProjectRole } from '../../generated/prisma/enums.js';
import type {
  SharedProjectDetailRecord,
  SharedProjectRecord,
  SharedProjectsListOptions,
  SharedProjectsRepository,
} from '../../modules/shared-projects/shared-projects.types.js';
import type { ProjectSort } from '../../modules/project/project.types.js';
import { refreshProjectRollup, writeDeleteChange } from './prisma-sync-writer.js';

const sharedProjectSelect = {
  revokedAt: true,
  deletedAt: true,
  project: {
    select: {
      id: true,
      name: true,
      description: true,
      deletedAt: true,
      updatedAt: true,
      owner: {
        select: {
          id: true,
          email: true,
        },
      },
      _count: {
        select: {
          scans: {
            where: {
              deletedAt: null,
            },
          },
        },
      },
    },
  },
} as const;

interface SharedProjectRow {
  revokedAt: Date | null;
  deletedAt: Date | null;
  project: {
    id: string;
    name: string;
    description: string | null;
    deletedAt: Date | null;
    updatedAt: Date;
    owner: {
      id: string;
      email: string | null;
    };
    _count: {
      scans: number;
    };
  };
}

interface SharedProjectDetailRow extends SharedProjectRow {
  project: SharedProjectRow['project'] & {
    scans: {
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
    }[];
  };
}

type SortDirection = 'asc' | 'desc';

function toSharedProjectRecord(row: SharedProjectRow): SharedProjectRecord {
  return {
    id: row.project.id,
    name: row.project.name,
    description: row.project.description,
    owner: row.project.owner,
    scanCount: row.project._count.scans,
    thumbnail: null,
    updatedAt: row.project.updatedAt,
    projectDeletedAt: row.project.deletedAt,
    accessRevokedAt: row.revokedAt,
    accessDeletedAt: row.deletedAt,
  };
}

function toSharedProjectDetailRecord(row: SharedProjectDetailRow): SharedProjectDetailRecord {
  return {
    ...toSharedProjectRecord(row),
    scans: row.project.scans.map((scan) => ({
      id: scan.id,
      name: scan.name,
      description: scan.description,
      thumbnail: scan.thumbnail,
      noteCount: scan._count.notes,
      assetStatus: scan.assetStatus,
      syncStatus: scan.syncStatus,
      createdAt: scan.createdAt,
    })),
  };
}

const sharedProjectDetailSelect = {
  ...sharedProjectSelect,
  project: {
    ...sharedProjectSelect.project,
    select: {
      ...sharedProjectSelect.project.select,
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
    },
  },
} as const;

function orderByFor(sort: ProjectSort): Array<{ project: Record<string, SortDirection> }> {
  const [field, direction] = sort.split(':') as ['updatedAt' | 'createdAt' | 'name', SortDirection];

  return [{ project: { [field]: direction } }, { project: { id: direction } }];
}

type SharedProjectsClient = Pick<PrismaClient, 'projectAccess' | 'project' | '$transaction'>;

export class PrismaSharedProjectsRepository implements SharedProjectsRepository {
  readonly #client: SharedProjectsClient;

  constructor(client: SharedProjectsClient) {
    this.#client = client;
  }

  async list(
    userId: string,
    options: SharedProjectsListOptions,
  ): Promise<{ items: SharedProjectRecord[]; total: number }> {
    const where = {
      userId,
      role: PrismaProjectRole.VIEWER,
      deletedAt: null,
      ...(options.search === undefined
        ? {}
        : {
            project: {
              name: {
                contains: options.search,
                mode: 'insensitive' as const,
              },
            },
          }),
    };
    const [rows, total] = await this.#client.$transaction([
      this.#client.projectAccess.findMany({
        where,
        orderBy: orderByFor(options.sort),
        skip: (options.page - 1) * options.limit,
        take: options.limit,
        select: sharedProjectSelect,
      }),
      this.#client.projectAccess.count({ where }),
    ]);

    return {
      items: rows.map(toSharedProjectRecord),
      total,
    };
  }

  async findSharedForUser(
    projectId: string,
    userId: string,
  ): Promise<SharedProjectDetailRecord | null> {
    const row = await this.#client.projectAccess.findFirst({
      where: { projectId, userId, role: PrismaProjectRole.VIEWER, deletedAt: null },
      select: sharedProjectDetailSelect,
    });

    return row === null ? null : toSharedProjectDetailRecord(row);
  }

  async findAccessStatus(
    projectId: string,
    userId: string,
  ): Promise<{ revokedAt: Date | null; deletedAt: Date | null } | null> {
    const access = await this.#client.projectAccess.findFirst({
      where: { projectId, userId, role: PrismaProjectRole.VIEWER },
      select: { revokedAt: true, deletedAt: true },
    });

    return access === null ? null : { revokedAt: access.revokedAt, deletedAt: access.deletedAt };
  }

  async findProjectOwner(projectId: string): Promise<string | null> {
    const project = await this.#client.project.findFirst({
      where: { id: projectId },
      select: { ownerId: true },
    });

    return project?.ownerId ?? null;
  }

  async removeFromShared(projectId: string, userId: string, removedAt: Date): Promise<boolean> {
    return await this.#client.$transaction(async (transaction) => {
      const access = await transaction.projectAccess.findFirst({
        where: { projectId, userId, role: PrismaProjectRole.VIEWER },
        select: {
          id: true,
          revision: true,
          revokedAt: true,
          deletedAt: true,
          project: { select: { ownerId: true } },
        },
      });
      if (access === null) return false;
      if (access.deletedAt !== null) return true;

      const updated = await transaction.projectAccess.updateMany({
        where: {
          id: access.id,
          userId,
          role: PrismaProjectRole.VIEWER,
          deletedAt: null,
          revision: access.revision,
        },
        data: { deletedAt: removedAt, revision: { increment: 1 }, updatedAt: removedAt },
      });
      if (updated.count === 0) return false;

      const change = {
        projectId,
        ownerId: access.project.ownerId,
        resourceType: 'PROJECT_ACCESS' as const,
        resourceId: access.id,
        revision: access.revision + 1,
        deletedAt: removedAt,
      };
      await writeDeleteChange(transaction, change);
      await writeDeleteChange(transaction, { ...change, targetUserId: userId });
      await refreshProjectRollup(transaction, projectId, removedAt);
      return true;
    });
  }
}
