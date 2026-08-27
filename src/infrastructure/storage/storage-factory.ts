import type { AppConfig } from '../../config/env.js';
import { LocalStorageAdapter } from './local-storage-adapter.js';
import { MinioStorageAdapter } from './minio-storage-adapter.js';
import type { StorageAdapter } from './storage.types.js';

export function createStorageAdapter(config: AppConfig): StorageAdapter {
  switch (config.storageProvider) {
    case 'minio':
      return new MinioStorageAdapter({
        bucket: config.storageBucket,
        endPoint: config.storageEndpoint,
        accessKey: config.storageAccessKeyId,
        secretKey: config.storageSecretAccessKey,
        useSSL: config.storageUseSsl,
        publicEndPoint: config.storagePublicEndpoint,
        publicUseSSL: config.storagePublicUseSsl,
        ...(config.storageRegion === '' ? {} : { region: config.storageRegion }),
      });
    case 'local':
      return new LocalStorageAdapter();
    default:
      throw new Error(`Unsupported STORAGE_PROVIDER: ${config.storageProvider}`);
  }
}
