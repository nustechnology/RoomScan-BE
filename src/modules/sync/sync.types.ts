export type SyncResourceType = 'PROJECT' | 'SCAN' | 'NOTE' | 'SCAN_ASSET' | 'PROJECT_ACCESS';
export type SyncOperation = 'UPSERT' | 'DELETE';
export type SyncStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED' | 'CONFLICT';

export interface SyncChangeRecord {
  sequence: bigint;
  resourceType: SyncResourceType;
  resourceId: string;
  operation: SyncOperation;
  revision: number;
  syncStatus: SyncStatus;
  changedAt: Date;
  deletedAt: Date | null;
  data: Record<string, unknown> | null;
}

export interface SyncChangeResultItem {
  resourceType: SyncResourceType;
  resourceId: string;
  operation: SyncOperation;
  revision: number;
  syncStatus: SyncStatus;
  changedAt: string;
  cursor: string;
  deletedAt: string | null;
  data: Record<string, unknown> | null;
}

export interface SyncChangesResult {
  changes: SyncChangeResultItem[];
  nextCursor: string;
}

export interface SyncStatusItem {
  projectId: string;
  syncStatus: SyncStatus;
  pendingCount: number;
  syncingCount: number;
  failedCount: number;
  conflictCount: number;
  lastSyncedAt: string | null;
  requiredAssetsUploaded: boolean;
}

export interface SyncStatusResult {
  items: SyncStatusItem[];
}

export interface SnapshotPage {
  items: SyncChangeRecord[];
  hasMore: boolean;
}

export interface IncrementalPage {
  items: SyncChangeRecord[];
}

export interface SyncRepository {
  getWatermark(): Promise<bigint>;
  listSnapshot(
    userId: string,
    watermark: bigint,
    after: { resourceType: SyncResourceType; resourceId: string } | null,
    limit: number,
  ): Promise<SnapshotPage>;
  listIncremental(
    userId: string,
    afterSequence: bigint,
    throughSequence: bigint,
    since: Date | null,
    limit: number,
  ): Promise<IncrementalPage>;
  acknowledge(userId: string, sequence: bigint, acknowledgedAt: Date): Promise<void>;
  listStatuses(userId: string, projectId?: string): Promise<SyncStatusItem[]>;
}
