import { describe, expect, it } from 'vitest';

import type { AppConfig } from '../src/config/env.js';
import { createLogger } from '../src/infrastructure/logging/logger.js';

function makeConfig(logLevel: AppConfig['logLevel']): AppConfig {
  return {
    nodeEnv: 'test',
    port: 3000,
    databaseUrl: 'postgresql://roomscan:roomscan@localhost:5432/roomscan',
    logLevel,
    corsOrigins: '*',
    trustProxy: false,
    apiRateLimitWindowSeconds: 60,
    apiRateLimitMaxRequests: 120,
    appleAuthRateLimitWindowSeconds: 900,
    appleAuthRateLimitMaxRequests: 20,
    refreshAuthRateLimitWindowSeconds: 900,
    refreshAuthRateLimitMaxRequests: 10,
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
    assetMinModelSizeBytes: 10_000_000,
    assetMaxModelSizeBytes: 500_000_000,
    assetMaxThumbnailSizeBytes: 10_000_000,
    invitationTtlSeconds: 604_800,
    invitationBaseUrl: 'http://localhost:3000',
    mailProvider: 'log',
    smtpHost: '',
    smtpPort: 2525,
    smtpUser: '',
    smtpPass: '',
    smtpSecure: false,
    mailFrom: 'RoomScan App <notifications@roomscan.app>',
  };
}

describe('createLogger', () => {
  it('uses the configured log level', () => {
    const logger = createLogger(makeConfig('debug'));

    expect(logger.level).toBe('debug');
  });

  it('disables output for the silent level', () => {
    const logger = createLogger(makeConfig('silent'));

    expect(logger.level).toBe('silent');
  });
});
