import type {
  IdempotencyContext,
  IdempotencyResult,
} from '../../common/idempotency/idempotency.types.js';

export type ScanAssetType = 'MODEL' | 'THUMBNAIL';
export type ScanAssetStatus = 'PENDING' | 'UPLOADING' | 'UPLOADED' | 'FAILED';

export const MODEL_CONTENT_TYPES = [
  'model/gltf-binary',
  'model/gltf+json',
  'application/octet-stream',
  'model/usd',
  'model/usdz',
] as const;

export const THUMBNAIL_CONTENT_TYPES = ['image/jpeg', 'image/png'] as const;

export interface ScanAssetRecord {
  id: string;
  scanId: string;
  assetType: ScanAssetType;
  status: ScanAssetStatus;
  contentType: string;
  sizeBytes: number;
  checksum: string | null;
  modelVersion: string | null;
  revision?: number;
  deletedAt?: Date | null;
  storageKey: string;
  idempotencyKey: string | null;
  uploadedAt: Date | null;
  uploadUrlExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ScanAssetCreateData {
  id?: string;
  scanId: string;
  assetType: ScanAssetType;
  contentType: string;
  sizeBytes: number;
  checksum: string | null;
  modelVersion: string | null;
  storageKey: string;
  idempotencyKey: string | null;
  uploadUrlExpiresAt: Date;
}

export interface ScanAssetUpdateData {
  status?: ScanAssetStatus;
  contentType?: string;
  sizeBytes?: number;
  checksum?: string | null;
  modelVersion?: string | null;
  storageKey?: string;
  idempotencyKey?: string | null;
  uploadedAt?: Date | null;
  uploadUrlExpiresAt?: Date | null;
  thumbnailUrl?: string | null;
}

export interface ScanAssetRepository {
  readonly managesSyncRollups?: boolean;
  findById(id: string): Promise<ScanAssetRecord | null>;
  findByScanAndType(scanId: string, assetType: ScanAssetType): Promise<ScanAssetRecord | null>;
  create(data: ScanAssetCreateData): Promise<{ record: ScanAssetRecord; created: boolean }>;
  saveUploadSessionIdempotently?(
    existingId: string | null,
    data: ScanAssetCreateData,
    context: IdempotencyContext,
    result: CreateUploadSessionResult,
    reuseWithoutMutation: boolean,
  ): Promise<IdempotencyResult<CreateUploadSessionResult>>;
  update(id: string, data: ScanAssetUpdateData): Promise<ScanAssetRecord>;
  listByScan(scanId: string): Promise<ScanAssetRecord[]>;
}

export interface ScanAssetMetadata {
  assetId: string;
  scanId: string;
  assetType: ScanAssetType;
  status: ScanAssetStatus;
  contentType: string;
  sizeBytes: number;
  checksum: string | null;
  modelVersion: string | null;
  revision?: number;
  uploadedAt: string | null;
  uploadSessionId: string;
  uploadUrlExpiresAt: string | null;
  downloadUrlExpiresAt: string | null;
}

export interface CreateUploadSessionResult {
  uploadSessionId: string;
  assetId: string;
  assetType: ScanAssetType;
  status: ScanAssetStatus;
  uploadUrl: string;
  uploadUrlExpiresAt: string;
  created: boolean;
  revision?: number;
}

export interface DownloadUrlResult {
  downloadUrl: string;
  downloadUrlExpiresAt: string;
  asset: ScanAssetMetadata;
}

export interface ScanAssetListResult {
  items: ScanAssetMetadata[];
}
