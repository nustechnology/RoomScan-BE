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
    assetMinModelSizeBytes: 10_000_000,
    assetMaxModelSizeBytes: 500_000_000,
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
  };
}

function createCapturingStream() {
  const lines: string[] = [];
  return {
    lines,
    write(chunk: string) {
      lines.push(chunk);
    },
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

  it('never emits storage keys, signed/download/upload URLs, or connection strings', () => {
    const stream = createCapturingStream();
    const logger = createLogger(makeConfig('info'), stream);

    logger.info(
      {
        storageKey: 'scans/secret-scan-id/model',
        signedUrl: 'https://storage.example/secret-signed-url',
        downloadUrl: 'https://storage.example/secret-download-url',
        uploadUrl: 'https://storage.example/secret-upload-url',
        connectionString: 'postgresql://user:pass@host:5432/db',
      },
      'test message',
    );

    const emitted = stream.lines.join('\n');
    expect(emitted).not.toContain('secret-scan-id');
    expect(emitted).not.toContain('secret-signed-url');
    expect(emitted).not.toContain('secret-download-url');
    expect(emitted).not.toContain('secret-upload-url');
    expect(emitted).not.toContain('user:pass');
    expect(emitted).toContain('[REDACTED]');
  });

  it('never emits an Authorization header or the database connection string', () => {
    const stream = createCapturingStream();
    const logger = createLogger(makeConfig('info'), stream);

    logger.info(
      {
        req: { headers: { authorization: 'Bearer secret-token', cookie: 'session=secret' } },
        databaseUrl: 'postgresql://user:pass@host:5432/db',
      },
      'test message',
    );

    const emitted = stream.lines.join('\n');
    expect(emitted).not.toContain('secret-token');
    expect(emitted).not.toContain('session=secret');
    expect(emitted).not.toContain('user:pass@host');
  });
});
