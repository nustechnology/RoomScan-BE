export type ScanRole = 'OWNER' | 'VIEWER';
export type ScanSyncStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED' | 'CONFLICT';
export type ScanAssetStatus = 'NONE' | 'PENDING' | 'UPLOADING' | 'UPLOADED' | 'FAILED';
export type ScanSort =
  | 'createdAt:desc'
  | 'createdAt:asc'
  | 'updatedAt:desc'
  | 'updatedAt:asc'
  | 'name:asc'
  | 'name:desc';

export interface ScanCreator {
  id: string;
  email: string | null;
}

export interface ScanRecord {
  id: string;
  projectId: string;
  createdById: string;
  creator: ScanCreator;
  name: string;
  description: string | null;
  thumbnail: string | null;
  noteCount: number;
  assetStatus: ScanAssetStatus;
  syncStatus: ScanSyncStatus;
  modelVersion: number;
  clientMutationId: string | null;
  deletedAt: Date | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ScanPermissions {
  role: ScanRole;
  canView: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export interface ScanResult {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  thumbnail: string | null;
  creator: ScanCreator;
  noteCount: number;
  assetStatus: ScanAssetStatus;
  syncStatus: ScanSyncStatus;
  modelVersion: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
  permissions: ScanPermissions;
}

export interface ScanCreateInput {
  name: string;
  description: string | null;
  clientMutationId?: string;
}

export interface ScanUpdateInput {
  name?: string;
  description?: string | null;
}

export interface ScanListOptions {
  page: number;
  limit: number;
  sort: ScanSort;
}

export interface ScanListResult {
  items: ScanResult[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ScanRepository {
  create(
    projectId: string,
    createdById: string,
    data: ScanCreateInput,
  ): Promise<{ record: ScanRecord; created: boolean }>;
  listByProject(
    projectId: string,
    options: ScanListOptions,
  ): Promise<{
    items: ScanRecord[];
    total: number;
  }>;
  findProjectId(id: string): Promise<string | null>;
  findByIdForUser(
    id: string,
    userId: string,
  ): Promise<{ record: ScanRecord; role: ScanRole } | null>;
  update(
    id: string,
    ownerId: string,
    data: ScanUpdateInput,
    expectedRevision?: number,
  ): Promise<ScanRecord>;
  softDelete(id: string, ownerId: string): Promise<void>;
  updateAssetStatus(
    scanId: string,
    data: { assetStatus?: ScanAssetStatus; syncStatus?: ScanSyncStatus },
  ): Promise<void>;
  updateThumbnail(scanId: string, thumbnail: string | null): Promise<void>;
}
