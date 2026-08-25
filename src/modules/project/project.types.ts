import type {
  IdempotencyContext,
  IdempotencyResult,
} from '../../common/idempotency/idempotency.types.js';

export type ProjectRole = 'OWNER' | 'VIEWER';
export type ProjectSyncStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED' | 'CONFLICT';
export type ProjectSort =
  | 'updatedAt:desc'
  | 'updatedAt:asc'
  | 'createdAt:desc'
  | 'createdAt:asc'
  | 'name:asc'
  | 'name:desc';

export interface ProjectOwner {
  id: string;
  email: string | null;
  displayName: string | null;
}

export interface ProjectScanSummary {
  id: string;
  name: string;
  description: string | null;
  thumbnail: string | null;
  noteCount: number;
  assetStatus: 'NONE' | 'PENDING' | 'UPLOADING' | 'UPLOADED' | 'FAILED';
  syncStatus: ProjectSyncStatus;
  createdAt: Date;
}

export type ProjectScanSummaryResult = Omit<ProjectScanSummary, 'createdAt'> & {
  createdAt: string;
};

export interface ProjectRecord {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  owner: ProjectOwner;
  scanCount: number;
  scans: ProjectScanSummary[];
  sharedCount: number;
  thumbnail: string | null;
  syncStatus: ProjectSyncStatus | null;
  revision: number;
  lastSyncedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectPermissions {
  role: ProjectRole;
  canView: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canShare: boolean;
  canCreateScan: boolean;
}

export interface ProjectResult {
  id: string;
  name: string;
  description: string | null;
  owner: ProjectOwner;
  scanCount: number;
  scans: ProjectScanSummaryResult[];
  sharedCount: number;
  thumbnail: string | null;
  syncStatus: ProjectSyncStatus | null;
  revision: number;
  lastSyncedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  permissions: ProjectPermissions;
}

export interface ProjectCreateInput {
  name: string;
  description: string | null;
}

export interface ProjectUpdateInput {
  name?: string;
  description?: string | null;
}

export interface ProjectListOptions {
  search?: string;
  page: number;
  limit: number;
  sort: ProjectSort;
}

export interface ProjectListResult {
  items: ProjectResult[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ProjectRepository {
  create(ownerId: string, data: ProjectCreateInput): Promise<ProjectRecord>;
  createIdempotently?(
    ownerId: string,
    data: ProjectCreateInput,
    context: IdempotencyContext,
  ): Promise<IdempotencyResult<ProjectResult>>;
  list(
    ownerId: string,
    options: ProjectListOptions,
  ): Promise<{
    items: ProjectRecord[];
    total: number;
  }>;
  findByIdForUser(
    id: string,
    userId: string,
  ): Promise<{ record: ProjectRecord; role: ProjectRole } | null>;
  findAccessRole(id: string, userId: string): Promise<ProjectRole | null>;
  update(
    id: string,
    ownerId: string,
    expectedRevision: number,
    data: ProjectUpdateInput,
  ): Promise<ProjectRecord>;
  softDelete(id: string, ownerId: string, expectedRevision: number): Promise<number>;
}
