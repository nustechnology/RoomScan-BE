import { Client as MinioClient } from 'minio';
import type { ScanAssetType } from '../../modules/scan-asset/scan-asset.types.js';
import type {
  StorageAdapter,
  StorageDownloadOptions,
  StorageDownloadUrl,
  StorageUploadOptions,
  StorageUploadUrl,
} from './storage.types.js';

export interface MinioStorageAdapterOptions {
  bucket: string;
  endPoint: string;
  accessKey: string;
  secretKey: string;
  useSSL?: boolean;
  region?: string;
  client?: MinioClient;
}

const DEFAULT_PORT = 9000;
const OBJECT_NOT_FOUND_CODES = new Set(['NoSuchKey', 'NotFound']);

function splitEndpoint(endPoint: string): { endPoint: string; port?: number } {
  const match = /^(.*):(\d+)$/.exec(endPoint.trim());
  if (match === null) {
    return { endPoint: endPoint.trim() };
  }
  return {
    endPoint: match[1] ?? endPoint.trim(),
    port: Number(match[2]),
  };
}

function isObjectNotFound(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const code = (error as Error & { code?: string }).code;
  return typeof code === 'string' && OBJECT_NOT_FOUND_CODES.has(code);
}

/**
 * S3-compatible MinIO adapter. Mints presigned upload/download URLs for the
 * configured bucket and verifies uploaded objects with a stat (head) request.
 * The bucket is created lazily on first use and the creation is cached so it
 * runs at most once per process.
 */
export class MinioStorageAdapter implements StorageAdapter {
  readonly provider = 'minio';

  readonly #client: MinioClient;
  readonly #bucket: string;
  readonly #region: string | undefined;
  #ensureBucketPromise: Promise<void> | null = null;

  constructor(options: MinioStorageAdapterOptions) {
    const useSSL = options.useSSL ?? false;
    const { endPoint, port } = splitEndpoint(options.endPoint);
    this.#client =
      options.client ??
      new MinioClient({
        endPoint,
        port: port ?? DEFAULT_PORT,
        useSSL,
        accessKey: options.accessKey,
        secretKey: options.secretKey,
        ...(options.region === undefined ? {} : { region: options.region }),
      });
    this.#bucket = options.bucket;
    this.#region = options.region;
  }

  buildObjectKey(scanId: string, assetType: ScanAssetType): string {
    return `scans/${scanId}/${assetType.toLowerCase()}`;
  }

  #ensureBucket(): Promise<void> {
    if (this.#ensureBucketPromise === null) {
      this.#ensureBucketPromise = this.#createBucketIfMissing();
    }
    return this.#ensureBucketPromise;
  }

  async #createBucketIfMissing(): Promise<void> {
    try {
      const exists = await this.#client.bucketExists(this.#bucket);
      if (!exists) {
        await this.#client.makeBucket(this.#bucket, this.#region);
      }
    } catch (error) {
      this.#ensureBucketPromise = null;
      throw error;
    }
  }

  #expirySeconds(expiresAt: Date): number {
    return Math.max(1, Math.round((expiresAt.getTime() - Date.now()) / 1000));
  }

  async createUploadUrl(
    objectKey: string,
    options: StorageUploadOptions,
  ): Promise<StorageUploadUrl> {
    await this.#ensureBucket();
    const url = await this.#client.presignedPutObject(
      this.#bucket,
      objectKey,
      this.#expirySeconds(options.expiresAt),
    );
    return { url, expiresAt: options.expiresAt };
  }

  async createDownloadUrl(
    objectKey: string,
    options: StorageDownloadOptions,
  ): Promise<StorageDownloadUrl> {
    await this.#ensureBucket();
    const url = await this.#client.presignedGetObject(
      this.#bucket,
      objectKey,
      this.#expirySeconds(options.expiresAt),
    );
    return { url, expiresAt: options.expiresAt };
  }

  async verifyObject(objectKey: string): Promise<boolean> {
    await this.#ensureBucket();
    try {
      await this.#client.statObject(this.#bucket, objectKey);
      return true;
    } catch (error) {
      if (isObjectNotFound(error)) {
        return false;
      }
      throw error;
    }
  }
}
