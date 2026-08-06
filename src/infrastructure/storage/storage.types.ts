import type { ScanAssetType } from '../../modules/scan-asset/scan-asset.types.js';

export interface StorageUploadUrl {
  url: string;
  expiresAt: Date;
}

export interface StorageDownloadUrl {
  url: string;
  expiresAt: Date;
}

export interface StorageUploadOptions {
  contentType: string;
  sizeBytes: number;
  expiresAt: Date;
}

export interface StorageDownloadOptions {
  expiresAt: Date;
}

export interface StorageAdapter {
  readonly provider: string;
  buildObjectKey(scanId: string, assetType: ScanAssetType): string;
  createUploadUrl(objectKey: string, options: StorageUploadOptions): Promise<StorageUploadUrl>;
  createDownloadUrl(
    objectKey: string,
    options: StorageDownloadOptions,
  ): Promise<StorageDownloadUrl>;
  verifyObject(objectKey: string): Promise<boolean>;
}
