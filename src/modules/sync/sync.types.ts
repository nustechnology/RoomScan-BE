export type SyncResourceType = 'project' | 'scan' | 'note';
export type SyncOperation = 'CREATE' | 'UPDATE' | 'DELETE';
export type SyncStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED' | 'CONFLICT';

export interface SyncChange {
  resourceType: SyncResourceType;
  resourceId: string;
  operation: SyncOperation;
  revision: number;
  syncStatus: SyncStatus | null;
  changedAt: Date;
  deletedAt: Date | null;
  cursor: string;
}

export interface SyncChangeResult {
  resourceType: SyncResourceType;
  resourceId: string;
  operation: SyncOperation;
  revision: number;
  syncStatus: SyncStatus | null;
  changedAt: string;
  deletedAt: string | null;
  cursor: string;
}

export interface SyncChangesOptions {
  since?: Date;
  cursor?: string;
  limit: number;
}

export interface SyncChangesResult {
  changes: SyncChangeResult[];
  nextCursor: string | null;
}

export interface SyncProjectStatus {
  projectId: string;
  syncStatus: SyncStatus;
  pendingCount: number;
  syncingCount: number;
  failedCount: number;
  conflictCount: number;
  lastSyncedAt: string | null;
  requiredAssetsUploaded: boolean;
}

export interface SyncProjectStatusRecord {
  projectId: string;
  syncStatus: SyncStatus;
  pendingCount: number;
  syncingCount: number;
  failedCount: number;
  conflictCount: number;
  lastSyncedAt: Date | null;
  requiredAssetsUploaded: boolean;
}

export interface SyncRepository {
  listChanges(
    userId: string,
    options: SyncChangesOptions,
  ): Promise<{
    changes: SyncChange[];
    hasMore: boolean;
  }>;
  listProjectStatuses(userId: string): Promise<SyncProjectStatusRecord[]>;
  findProjectStatus(userId: string, projectId: string): Promise<SyncProjectStatusRecord | null>;
}
