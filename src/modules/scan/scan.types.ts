import type {
  IdempotencyContext,
  IdempotencyResult,
} from '../../common/idempotency/idempotency.types.js';
import type { ScanAssetCreateData, ScanAssetType } from '../scan-asset/scan-asset.types.js';

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
  revision: number;
  clientMutationId: string | null;
  deletedAt: Date | null;
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

export interface ScanCreateUploadDescriptor {
  assetType: ScanAssetType;
  contentType: string;
  sizeBytes: number;
  checksum?: string;
  modelVersion?: string;
}

export interface PreparedScanCreateUpload {
  data: ScanAssetCreateData & { id: string };
  response: {
    uploadSessionId: string;
    assetId: string;
    uploadUrl: string;
    uploadUrlExpiresAt: string;
  };
}

export interface ScanCreateWithUploadsResult extends ScanResult {
  uploads?: {
    thumbnail?: PreparedScanCreateUpload['response'];
    scanFile?: PreparedScanCreateUpload['response'];
  };
}

export interface ScanUploadPreparer {
  prepareScanCreateUploads(
    scanId: string,
    uploads: ScanCreateUploadDescriptor[],
  ): Promise<PreparedScanCreateUpload[]>;
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
  createIdempotently(
    projectId: string,
    createdById: string,
    data: ScanCreateInput,
    context: IdempotencyContext,
  ): Promise<IdempotencyResult<ScanResult>>;
  createWithUploadsIdempotently(
    scanId: string,
    projectId: string,
    createdById: string,
    data: ScanCreateInput,
    uploads: PreparedScanCreateUpload[],
    context: IdempotencyContext,
  ): Promise<IdempotencyResult<ScanCreateWithUploadsResult>>;
  listByProject(
    projectId: string,
    options: ScanListOptions,
  ): Promise<{
    items: ScanRecord[];
    total: number;
  }>;
  findProjectId(id: string): Promise<string | null>;
  findAccessRole(id: string, userId: string): Promise<ScanRole | null>;
  findByIdForUser(
    id: string,
    userId: string,
  ): Promise<{ record: ScanRecord; role: ScanRole } | null>;
  update(
    id: string,
    ownerId: string,
    expectedRevision: number,
    data: ScanUpdateInput,
  ): Promise<ScanRecord>;
  softDelete(id: string, ownerId: string, expectedRevision: number): Promise<number>;
  updateAssetStatus(
    scanId: string,
    data: { assetStatus?: ScanAssetStatus; syncStatus?: ScanSyncStatus },
  ): Promise<void>;
  updateThumbnail(scanId: string, thumbnail: string | null): Promise<void>;
}
