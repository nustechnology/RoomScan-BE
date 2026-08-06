import { ProjectNotFoundError } from '../project/project.errors.js';
import type { ProjectPermissionService } from '../project/project.permissions.js';
import { ScanNotFoundError } from '../scan/scan.errors.js';
import type { ScanRepository } from '../scan/scan.types.js';
import {
  AssetNotReadyError,
  AssetUploadFailedError,
  InvalidAssetRequestError,
  ScanAssetNotFoundError,
  StorageUnavailableError,
  UploadSessionExpiredError,
} from './scan-asset.errors.js';
import type {
  CreateUploadSessionResult,
  DownloadUrlResult,
  ScanAssetCreateData,
  ScanAssetListResult,
  ScanAssetMetadata,
  ScanAssetRecord,
  ScanAssetRepository,
  ScanAssetType,
  ScanAssetUpdateData,
} from './scan-asset.types.js';
import { MODEL_CONTENT_TYPES, THUMBNAIL_CONTENT_TYPES } from './scan-asset.types.js';
import type {
  StorageAdapter,
  StorageDownloadUrl,
  StorageUploadOptions,
} from '../../infrastructure/storage/storage.types.js';

export interface ScanAssetServiceDependencies {
  repository: ScanAssetRepository;
  scanRepository: ScanRepository;
  permissions: ProjectPermissionService;
  storage: StorageAdapter;
  clock?: () => Date;
  uploadUrlTtlSeconds: number;
  downloadUrlTtlSeconds: number;
  maxModelSizeBytes: number;
  maxThumbnailSizeBytes: number;
}

function toMetadata(record: ScanAssetRecord): ScanAssetMetadata {
  return {
    assetId: record.id,
    scanId: record.scanId,
    assetType: record.assetType,
    status: record.status,
    contentType: record.contentType,
    sizeBytes: record.sizeBytes,
    checksum: record.checksum,
    modelVersion: record.modelVersion,
    uploadedAt: record.uploadedAt === null ? null : record.uploadedAt.toISOString(),
    uploadSessionId: record.id,
    uploadUrlExpiresAt:
      record.uploadUrlExpiresAt === null ? null : record.uploadUrlExpiresAt.toISOString(),
    downloadUrlExpiresAt: null,
  };
}

export class ScanAssetService {
  readonly #repository: ScanAssetRepository;
  readonly #scanRepository: ScanRepository;
  readonly #permissions: ProjectPermissionService;
  readonly #storage: StorageAdapter;
  readonly #clock: () => Date;
  readonly #uploadUrlTtlSeconds: number;
  readonly #downloadUrlTtlSeconds: number;
  readonly #maxModelSizeBytes: number;
  readonly #maxThumbnailSizeBytes: number;

  constructor({
    repository,
    scanRepository,
    permissions,
    storage,
    clock,
    uploadUrlTtlSeconds,
    downloadUrlTtlSeconds,
    maxModelSizeBytes,
    maxThumbnailSizeBytes,
  }: ScanAssetServiceDependencies) {
    this.#repository = repository;
    this.#scanRepository = scanRepository;
    this.#permissions = permissions;
    this.#storage = storage;
    this.#clock = clock ?? (() => new Date());
    this.#uploadUrlTtlSeconds = uploadUrlTtlSeconds;
    this.#downloadUrlTtlSeconds = downloadUrlTtlSeconds;
    this.#maxModelSizeBytes = maxModelSizeBytes;
    this.#maxThumbnailSizeBytes = maxThumbnailSizeBytes;
  }

  async #requireView(scanId: string, userId: string): Promise<void> {
    const projectId = await this.#scanRepository.findProjectId(scanId);
    if (projectId === null) {
      throw new ScanNotFoundError();
    }
    try {
      await this.#permissions.requireView(projectId, userId);
    } catch (error) {
      if (error instanceof ProjectNotFoundError) {
        throw new ScanNotFoundError();
      }
      throw error;
    }
  }

  async #requireOwner(scanId: string, userId: string): Promise<void> {
    const projectId = await this.#scanRepository.findProjectId(scanId);
    if (projectId === null) {
      throw new ScanNotFoundError();
    }
    try {
      await this.#permissions.requireOwner(projectId, userId);
    } catch (error) {
      if (error instanceof ProjectNotFoundError) {
        throw new ScanNotFoundError();
      }
      throw error;
    }
  }

  #validateTypePayload(assetType: ScanAssetType, contentType: string, sizeBytes: number): void {
    const allowed: readonly string[] =
      assetType === 'MODEL' ? MODEL_CONTENT_TYPES : THUMBNAIL_CONTENT_TYPES;
    if (!allowed.includes(contentType)) {
      throw new InvalidAssetRequestError();
    }

    const maxSize = assetType === 'MODEL' ? this.#maxModelSizeBytes : this.#maxThumbnailSizeBytes;
    if (sizeBytes > maxSize) {
      throw new InvalidAssetRequestError();
    }
  }

  async createUploadSession(
    userId: string,
    scanId: string,
    data: {
      assetType: ScanAssetType;
      contentType: string;
      sizeBytes: number;
      checksum?: string;
      modelVersion?: string;
      idempotencyKey?: string;
    },
  ): Promise<CreateUploadSessionResult> {
    this.#validateTypePayload(data.assetType, data.contentType, data.sizeBytes);
    await this.#requireOwner(scanId, userId);

    const now = this.#clock();
    const objectKey = this.#storage.buildObjectKey(scanId, data.assetType);
    const existing = await this.#repository.findByScanAndType(scanId, data.assetType);

    const uploadOptions: StorageUploadOptions = {
      contentType: data.contentType,
      sizeBytes: data.sizeBytes,
      expiresAt: new Date(now.getTime() + this.#uploadUrlTtlSeconds * 1000),
    };

    if (existing !== null) {
      const active = existing.status === 'PENDING' || existing.status === 'UPLOADING';
      const expiry = existing.uploadUrlExpiresAt;

      if (active && expiry !== null && expiry > now) {
        const uploadUrl = await this.#storage.createUploadUrl(existing.storageKey, {
          ...uploadOptions,
          expiresAt: expiry,
        });
        return {
          uploadSessionId: existing.id,
          assetId: existing.id,
          assetType: existing.assetType,
          status: existing.status,
          uploadUrl: uploadUrl.url,
          uploadUrlExpiresAt: expiry.toISOString(),
          created: false,
        };
      }

      const update: ScanAssetUpdateData = {
        status: 'PENDING',
        contentType: data.contentType,
        sizeBytes: data.sizeBytes,
        storageKey: objectKey,
        idempotencyKey: data.idempotencyKey ?? existing.idempotencyKey,
        uploadUrlExpiresAt: uploadOptions.expiresAt,
      };
      if (data.checksum !== undefined) update.checksum = data.checksum;
      if (data.modelVersion !== undefined) update.modelVersion = data.modelVersion;
      const updated = await this.#repository.update(existing.id, update);
      const uploadUrl = await this.#storage.createUploadUrl(objectKey, uploadOptions);
      return {
        uploadSessionId: updated.id,
        assetId: updated.id,
        assetType: updated.assetType,
        status: updated.status,
        uploadUrl: uploadUrl.url,
        uploadUrlExpiresAt: uploadUrl.expiresAt.toISOString(),
        created: false,
      };
    }

    const createData: ScanAssetCreateData = {
      scanId,
      assetType: data.assetType,
      contentType: data.contentType,
      sizeBytes: data.sizeBytes,
      checksum: data.checksum ?? null,
      modelVersion: data.modelVersion ?? null,
      storageKey: objectKey,
      idempotencyKey: data.idempotencyKey ?? null,
      uploadUrlExpiresAt: uploadOptions.expiresAt,
    };
    const record = await this.#repository.create(createData);
    const uploadUrl = await this.#storage.createUploadUrl(objectKey, uploadOptions);
    return {
      uploadSessionId: record.id,
      assetId: record.id,
      assetType: record.assetType,
      status: record.status,
      uploadUrl: uploadUrl.url,
      uploadUrlExpiresAt: uploadUrl.expiresAt.toISOString(),
      created: true,
    };
  }

  async completeUpload(
    userId: string,
    uploadSessionId: string,
    data: { checksum?: string; sizeBytes?: number },
  ): Promise<ScanAssetMetadata> {
    const asset = await this.#repository.findById(uploadSessionId);
    if (asset === null) {
      throw new ScanAssetNotFoundError();
    }
    await this.#requireOwner(asset.scanId, userId);

    if (asset.status === 'UPLOADED') {
      if (asset.assetType === 'MODEL') {
        await this.#scanRepository.updateAssetStatus(asset.scanId, {
          assetStatus: 'UPLOADED',
          syncStatus: 'SYNCED',
        });
      }
      return toMetadata(asset);
    }

    const now = this.#clock();
    if (asset.uploadUrlExpiresAt !== null && asset.uploadUrlExpiresAt <= now) {
      throw new UploadSessionExpiredError();
    }

    let verified: boolean;
    try {
      verified = await this.#storage.verifyObject(asset.storageKey);
    } catch {
      throw new StorageUnavailableError();
    }

    if (!verified) {
      await this.#repository.update(asset.id, { status: 'FAILED' });
      throw new AssetUploadFailedError();
    }

    if (data.sizeBytes !== undefined) {
      const maxSize =
        asset.assetType === 'MODEL' ? this.#maxModelSizeBytes : this.#maxThumbnailSizeBytes;
      if (data.sizeBytes > maxSize) {
        throw new InvalidAssetRequestError();
      }
    }

    const update: ScanAssetUpdateData = {
      status: 'UPLOADED',
      uploadedAt: now,
      sizeBytes: data.sizeBytes ?? asset.sizeBytes,
      uploadUrlExpiresAt: null,
    };
    if (data.checksum !== undefined) update.checksum = data.checksum;
    const updated = await this.#repository.update(asset.id, update);

    if (asset.assetType === 'MODEL') {
      await this.#scanRepository.updateAssetStatus(asset.scanId, {
        assetStatus: 'UPLOADED',
        syncStatus: 'SYNCED',
      });
    }

    return toMetadata(updated);
  }

  async listAssets(userId: string, scanId: string): Promise<ScanAssetListResult> {
    await this.#requireView(scanId, userId);
    const assets = await this.#repository.listByScan(scanId);
    return { items: assets.map(toMetadata) };
  }

  async getDownloadUrl(
    userId: string,
    scanId: string,
    assetType: ScanAssetType,
  ): Promise<DownloadUrlResult> {
    await this.#requireView(scanId, userId);
    const asset = await this.#repository.findByScanAndType(scanId, assetType);
    if (asset === null) {
      throw new ScanAssetNotFoundError();
    }
    if (asset.status !== 'UPLOADED') {
      throw new AssetNotReadyError();
    }

    const now = this.#clock();
    const expiresAt = new Date(now.getTime() + this.#downloadUrlTtlSeconds * 1000);
    let downloadUrl: StorageDownloadUrl;
    try {
      downloadUrl = await this.#storage.createDownloadUrl(asset.storageKey, { expiresAt });
    } catch {
      throw new StorageUnavailableError();
    }

    return {
      downloadUrl: downloadUrl.url,
      downloadUrlExpiresAt: downloadUrl.expiresAt.toISOString(),
      asset: toMetadata(asset),
    };
  }

  async failUpload(
    userId: string,
    uploadSessionId: string,
    _data: { reason?: string },
  ): Promise<ScanAssetMetadata> {
    const asset = await this.#repository.findById(uploadSessionId);
    if (asset === null) {
      throw new ScanAssetNotFoundError();
    }
    await this.#requireOwner(asset.scanId, userId);

    if (asset.status === 'UPLOADED') {
      return toMetadata(asset);
    }

    const updated = await this.#repository.update(asset.id, { status: 'FAILED' });

    if (asset.assetType === 'MODEL') {
      await this.#scanRepository.updateAssetStatus(asset.scanId, {
        assetStatus: 'FAILED',
        syncStatus: 'FAILED',
      });
    }

    return toMetadata(updated);
  }
}
