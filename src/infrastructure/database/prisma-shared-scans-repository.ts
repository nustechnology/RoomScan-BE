import type { PrismaClient } from '../../generated/prisma/client.js';
import { ProjectRole as PrismaProjectRole } from '../../generated/prisma/enums.js';
import type {
  SharedScanRecord,
  SharedScansListOptions,
  SharedScansRepository,
} from '../../modules/shared-scans/shared-scans.types.js';
import type { ScanSort } from '../../modules/scan/scan.types.js';

const sharedScanSelect = {
  revokedAt: true,
  deletedAt: true,
  scan: {
    select: {
      id: true,
      projectId: true,
      name: true,
      description: true,
      thumbnail: true,
      deletedAt: true,
      updatedAt: true,
      assetStatus: true,
      syncStatus: true,
      modelVersion: true,
      creator: {
        select: {
          id: true,
          email: true,
        },
      },
      _count: {
        select: {
          notes: true,
        },
      },
    },
  },
} as const;

interface SharedScanRow {
  revokedAt: Date | null;
  deletedAt: Date | null;
  scan: {
    id: string;
    projectId: string;
    name: string;
    description: string | null;
    thumbnail: string | null;
    deletedAt: Date | null;
    updatedAt: Date;
    assetStatus: SharedScanRecord['assetStatus'];
    syncStatus: SharedScanRecord['syncStatus'];
    modelVersion: number;
    creator: {
      id: string;
      email: string | null;
    };
    _count: {
      notes: number;
    };
  };
}

type SortDirection = 'asc' | 'desc';

function toSharedScanRecord(row: SharedScanRow): SharedScanRecord {
  return {
    id: row.scan.id,
    projectId: row.scan.projectId,
    name: row.scan.name,
    description: row.scan.description,
    thumbnail: row.scan.thumbnail,
    creator: row.scan.creator,
    noteCount: row.scan._count.notes,
    assetStatus: row.scan.assetStatus,
    syncStatus: row.scan.syncStatus,
    modelVersion: row.scan.modelVersion,
    updatedAt: row.scan.updatedAt,
    scanDeletedAt: row.scan.deletedAt,
    accessRevokedAt: row.revokedAt,
    accessDeletedAt: row.deletedAt,
  };
}

function orderByFor(sort: ScanSort): Array<{ scan: Record<string, SortDirection> }> {
  const [field, direction] = sort.split(':') as ['updatedAt' | 'createdAt' | 'name', SortDirection];

  return [{ scan: { [field]: direction } }, { scan: { id: direction } }];
}

type SharedScansClient = Pick<PrismaClient, 'scanAccess' | 'scan' | '$transaction'>;

export class PrismaSharedScansRepository implements SharedScansRepository {
  readonly #client: SharedScansClient;

  constructor(client: SharedScansClient) {
    this.#client = client;
  }

  async list(
    userId: string,
    options: SharedScansListOptions,
  ): Promise<{ items: SharedScanRecord[]; total: number }> {
    const where = {
      userId,
      role: PrismaProjectRole.VIEWER,
      deletedAt: null,
      ...(options.search === undefined
        ? {}
        : {
            scan: {
              name: {
                contains: options.search,
                mode: 'insensitive' as const,
              },
            },
          }),
    };
    const [rows, total] = await this.#client.$transaction([
      this.#client.scanAccess.findMany({
        where,
        orderBy: orderByFor(options.sort),
        skip: (options.page - 1) * options.limit,
        take: options.limit,
        select: sharedScanSelect,
      }),
      this.#client.scanAccess.count({ where }),
    ]);

    return {
      items: rows.map(toSharedScanRecord),
      total,
    };
  }

  async findSharedForUser(scanId: string, userId: string): Promise<SharedScanRecord | null> {
    const row = await this.#client.scanAccess.findFirst({
      where: { scanId, userId, role: PrismaProjectRole.VIEWER, deletedAt: null },
      select: sharedScanSelect,
    });

    return row === null ? null : toSharedScanRecord(row);
  }

  async findAccessStatus(
    scanId: string,
    userId: string,
  ): Promise<{ revokedAt: Date | null; deletedAt: Date | null } | null> {
    const access = await this.#client.scanAccess.findFirst({
      where: { scanId, userId, role: PrismaProjectRole.VIEWER },
      select: { revokedAt: true, deletedAt: true },
    });

    return access === null ? null : { revokedAt: access.revokedAt, deletedAt: access.deletedAt };
  }

  async findScanOwner(scanId: string): Promise<string | null> {
    const scan = await this.#client.scan.findFirst({
      where: { id: scanId },
      select: {
        project: {
          select: {
            ownerId: true,
          },
        },
      },
    });

    return scan?.project?.ownerId ?? null;
  }

  async removeFromShared(scanId: string, userId: string, removedAt: Date): Promise<boolean> {
    const access = await this.#client.scanAccess.findFirst({
      where: { scanId, userId, role: PrismaProjectRole.VIEWER },
      select: { id: true, deletedAt: true },
    });
    if (access === null) return false;
    if (access.deletedAt !== null) return true;

    const updated = await this.#client.scanAccess.updateMany({
      where: { scanId, userId, role: PrismaProjectRole.VIEWER, deletedAt: null },
      data: { deletedAt: removedAt, updatedAt: removedAt },
    });

    return updated.count > 0;
  }
}
