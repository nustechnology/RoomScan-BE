import type { ScanAssetType } from '../../modules/scan-asset/scan-asset.types.js';
import type {
  StorageAdapter,
  StorageDownloadOptions,
  StorageDownloadUrl,
  StorageUploadOptions,
  StorageUploadUrl,
  StorageVerifyOptions,
} from './storage.types.js';

export interface LocalStorageAdapterOptions {
  baseUrl?: string;
}

/**
 * Fake, process-local storage adapter used everywhere until a real object
 * store provider is configured. It mints deterministic URLs with the requested
 * expiry but does not persist bytes, and it cannot independently verify an
 * upload, so completion is assumed valid.
 */
export class LocalStorageAdapter implements StorageAdapter {
  readonly provider = 'local';

  readonly #baseUrl: string;

  constructor(options: LocalStorageAdapterOptions = {}) {
    this.#baseUrl = options.baseUrl ?? 'http://storage.local';
  }

  buildObjectKey(scanId: string, assetType: ScanAssetType): string {
    return `scans/${scanId}/${assetType.toLowerCase()}`;
  }

  createUploadUrl(objectKey: string, options: StorageUploadOptions): Promise<StorageUploadUrl> {
    return Promise.resolve({
      url: `${this.#baseUrl}/upload/${objectKey}?contentType=${encodeURIComponent(
        options.contentType,
      )}&sizeBytes=${options.sizeBytes}`,
      expiresAt: options.expiresAt,
    });
  }

  createDownloadUrl(
    objectKey: string,
    options: StorageDownloadOptions,
  ): Promise<StorageDownloadUrl> {
    return Promise.resolve({
      url: `${this.#baseUrl}/download/${objectKey}`,
      expiresAt: options.expiresAt,
    });
  }

  createDisplayUrl(objectKey: string): Promise<string> {
    return Promise.resolve(`${this.#baseUrl}/download/${objectKey}`);
  }

  verifyObject(_objectKey: string, _expected: StorageVerifyOptions): Promise<boolean> {
    return Promise.resolve(true);
  }

  deleteObject(_objectKey: string): Promise<void> {
    return Promise.resolve();
  }
}
