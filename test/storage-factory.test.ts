import { describe, expect, it } from 'vitest';

import type { AppConfig } from '../src/config/env.js';
import { createStorageAdapter } from '../src/infrastructure/storage/storage-factory.js';
import { LocalStorageAdapter } from '../src/infrastructure/storage/local-storage-adapter.js';
import { MinioStorageAdapter } from '../src/infrastructure/storage/minio-storage-adapter.js';

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: 'test',
    port: 3000,
    databaseUrl: 'postgresql://roomscan:roomscan@localhost:5432/roomscan',
    logLevel: 'silent',
    corsOrigins: '*',
    trustProxy: false,
    apiRateLimitWindowSeconds: 60,
    apiRateLimitMaxRequests: 120,
    appleAuthRateLimitWindowSeconds: 900,
    appleAuthRateLimitMaxRequests: 20,
    refreshAuthRateLimitWindowSeconds: 900,
    refreshAuthRateLimitMaxRequests: 10,
    invitationCreateRateLimitWindowSeconds: 900,
    invitationCreateRateLimitMaxRequests: 20,
    invitationAcceptRateLimitWindowSeconds: 300,
    invitationAcceptRateLimitMaxRequests: 30,
    uploadSessionCreateRateLimitWindowSeconds: 900,
    uploadSessionCreateRateLimitMaxRequests: 30,
    downloadUrlRateLimitWindowSeconds: 300,
    downloadUrlRateLimitMaxRequests: 60,
    appleClientId: 'com.example.roomscan',
    accessTokenSecret: 'access-secret-that-is-at-least-32-characters',
    refreshTokenSecret: 'refresh-secret-that-is-at-least-32-characters',
    syncCryptoKey: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
    accessTokenTtlSeconds: 3600,
    refreshTokenTtlSeconds: 2_592_000,
    localTestAuthEnabled: false,
    storageProvider: 'local',
    storageBucket: '',
    storageRegion: '',
    storageEndpoint: '',
    storageAccessKeyId: '',
    storageSecretAccessKey: '',
    storageUseSsl: false,
    storagePublicEndpoint: '',
    storagePublicUseSsl: false,
    storageUploadUrlTtlSeconds: 900,
    storageDownloadUrlTtlSeconds: 60,
    assetMinModelSizeBytes: 0,
    assetMaxModelSizeBytes: 200_000_000,
    assetMaxThumbnailSizeBytes: 10_000_000,
    invitationTtlSeconds: 604_800,
    invitationBaseUrl: 'http://localhost:3000',
    uploadSessionExpiryGraceSeconds: 300,
    orphanAssetCleanupBatchSize: 200,
    mailProvider: 'log',
    smtpHost: '',
    smtpPort: 2525,
    smtpUser: '',
    smtpPass: '',
    smtpSecure: false,
    mailFrom: 'RoomScan App <notifications@roomscan.app>',
    ...overrides,
  };
}

describe('createStorageAdapter', () => {
  it('builds a LocalStorageAdapter for the local provider', () => {
    const adapter = createStorageAdapter(makeConfig({ storageProvider: 'local' }));

    expect(adapter).toBeInstanceOf(LocalStorageAdapter);
  });

  it('builds a MinioStorageAdapter for the minio provider', () => {
    const adapter = createStorageAdapter(
      makeConfig({
        storageProvider: 'minio',
        storageBucket: 'roomscan-assets',
        storageEndpoint: 'localhost:9000',
        storagePublicEndpoint: 'localhost:9000',
        storageAccessKeyId: 'access-key',
        storageSecretAccessKey: 'secret-key',
        storageRegion: 'us-east-1',
      }),
    );

    expect(adapter).toBeInstanceOf(MinioStorageAdapter);
  });
});
