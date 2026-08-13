import { decodeSyncCursor } from './sync-cursor.js';
import { SyncProjectNotFoundError } from './sync.errors.js';
import type {
  SyncChange,
  SyncChangeResult,
  SyncChangesOptions,
  SyncChangesResult,
  SyncProjectStatus,
  SyncProjectStatusRecord,
  SyncRepository,
} from './sync.types.js';

export interface SyncServiceDependencies {
  repository: SyncRepository;
}

function toChangeResult(change: SyncChange): SyncChangeResult {
  return {
    resourceType: change.resourceType,
    resourceId: change.resourceId,
    operation: change.operation,
    revision: change.revision,
    syncStatus: change.syncStatus,
    changedAt: change.changedAt.toISOString(),
    deletedAt: change.deletedAt === null ? null : change.deletedAt.toISOString(),
    cursor: change.cursor,
  };
}

function toStatusResult(record: SyncProjectStatusRecord): SyncProjectStatus {
  return {
    projectId: record.projectId,
    syncStatus: record.syncStatus,
    pendingCount: record.pendingCount,
    syncingCount: record.syncingCount,
    failedCount: record.failedCount,
    conflictCount: record.conflictCount,
    lastSyncedAt: record.lastSyncedAt === null ? null : record.lastSyncedAt.toISOString(),
    requiredAssetsUploaded: record.requiredAssetsUploaded,
  };
}

export class SyncService {
  readonly #repository: SyncRepository;

  constructor({ repository }: SyncServiceDependencies) {
    this.#repository = repository;
  }

  async listChanges(userId: string, options: SyncChangesOptions): Promise<SyncChangesResult> {
    if (options.cursor !== undefined) {
      decodeSyncCursor(options.cursor);
    }

    const { changes, hasMore } = await this.#repository.listChanges(userId, options);

    const lastChange = changes.length > 0 ? changes[changes.length - 1] : undefined;

    return {
      changes: changes.map(toChangeResult),
      nextCursor: hasMore && lastChange !== undefined ? lastChange.cursor : null,
    };
  }

  async listStatus(userId: string): Promise<SyncProjectStatus[]> {
    const records = await this.#repository.listProjectStatuses(userId);
    return records.map(toStatusResult);
  }

  async getProjectStatus(userId: string, projectId: string): Promise<SyncProjectStatus> {
    const record = await this.#repository.findProjectStatus(userId, projectId);
    if (record === null) {
      throw new SyncProjectNotFoundError();
    }
    return toStatusResult(record);
  }
}
