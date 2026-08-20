import { ScanNotFoundError } from '../scan/scan.errors.js';
import { NotSharedScanError, SharedScanNotInListError } from './shared-scans.errors.js';
import type {
  SharedScanRecord,
  SharedScanRemoveResult,
  SharedScanResult,
  SharedScanStatus,
  SharedScansListOptions,
  SharedScansListResult,
  SharedScansRepository,
} from './shared-scans.types.js';

export interface SharedScansServiceDependencies {
  repository: SharedScansRepository;
  clock?: () => Date;
}

export function sharedScanStatus(record: SharedScanRecord): SharedScanStatus {
  if (record.scanDeletedAt !== null) {
    return record.accessRevokedAt === null ? 'TEMPORARILY_UNAVAILABLE' : 'SCAN_DELETED';
  }
  if (record.accessRevokedAt !== null) {
    return 'REVOKED';
  }
  return 'ACTIVE';
}

function toResult(record: SharedScanRecord): SharedScanResult {
  const status = sharedScanStatus(record);

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
    updatedAt: record.updatedAt.toISOString(),
    status,
    permissions: {
      role: 'VIEWER',
      canView: status === 'ACTIVE',
      canEdit: false,
      canDelete: false,
    },
  };
}

export class SharedScansService {
  readonly #repository: SharedScansRepository;
  readonly #clock: () => Date;

  constructor({ repository, clock }: SharedScansServiceDependencies) {
    this.#repository = repository;
    this.#clock = clock ?? (() => new Date());
  }

  async list(userId: string, options: SharedScansListOptions): Promise<SharedScansListResult> {
    const { items, total } = await this.#repository.list(userId, options);

    return {
      items: items.map(toResult),
      pagination: {
        page: options.page,
        limit: options.limit,
        total,
        totalPages: Math.ceil(total / options.limit),
      },
    };
  }

  async detail(userId: string, scanId: string): Promise<SharedScanResult> {
    const record = await this.#repository.findSharedForUser(scanId, userId);

    if (record === null || sharedScanStatus(record) !== 'ACTIVE') {
      throw new ScanNotFoundError();
    }

    return toResult(record);
  }

  async remove(userId: string, scanId: string): Promise<SharedScanRemoveResult> {
    const access = await this.#repository.findAccessStatus(scanId, userId);

    if (access === null) {
      const ownerId = await this.#repository.findScanOwner(scanId);
      if (ownerId === userId) {
        throw new NotSharedScanError();
      }
      throw new SharedScanNotInListError();
    }
    if (access.deletedAt !== null) {
      return {
        scanId,
        removedAt: access.deletedAt.toISOString(),
      };
    }

    const removedAt = this.#clock();
    const removed = await this.#repository.removeFromShared(scanId, userId, removedAt);

    if (!removed) {
      throw new SharedScanNotInListError();
    }

    return {
      scanId,
      removedAt: removedAt.toISOString(),
    };
  }
}
