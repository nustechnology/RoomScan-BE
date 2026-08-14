import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { loadConfig } from '../src/config/env.js';

const validEnvironment = {
  NODE_ENV: 'test',
  PORT: '4000',
  DATABASE_URL: 'postgresql://roomscan:roomscan@localhost:5432/roomscan',
  LOG_LEVEL: 'silent',
  CORS_ORIGIN: 'https://app.roomscan.dev, https://admin.roomscan.dev',
  APPLE_CLIENT_ID: 'com.example.roomscan',
  AUTH_ACCESS_TOKEN_SECRET: 'access-secret-that-is-at-least-32-characters',
  AUTH_REFRESH_TOKEN_SECRET: 'refresh-secret-that-is-at-least-32-characters',
};

describe('loadConfig', () => {
  it('parses and normalizes valid environment variables', () => {
    const config = loadConfig(validEnvironment);

    expect(config).toEqual({
      nodeEnv: 'test',
      port: 4000,
      databaseUrl: validEnvironment.DATABASE_URL,
      logLevel: 'silent',
      corsOrigins: ['https://app.roomscan.dev', 'https://admin.roomscan.dev'],
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
      storageUploadUrlTtlSeconds: 900,
      storageDownloadUrlTtlSeconds: 60,
      assetMinModelSizeBytes: 0,
      assetMaxModelSizeBytes: 200_000_000,
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
    });
  });

  it('enables local test authentication only in development', () => {
    const config = loadConfig({
      ...validEnvironment,
      NODE_ENV: 'development',
      LOCAL_TEST_AUTH_ENABLED: 'true',
    });

    expect(config.localTestAuthEnabled).toBe(true);
  });

  it.each(['test', 'staging', 'production'])(
    'rejects local test authentication in NODE_ENV=%s',
    (nodeEnv) => {
      expect(() =>
        loadConfig({
          ...validEnvironment,
          NODE_ENV: nodeEnv,
          LOCAL_TEST_AUTH_ENABLED: 'true',
        }),
      ).toThrow(/only be enabled when NODE_ENV=development/);
    },
  );

  it('rejects an invalid local test authentication flag', () => {
    expect(() =>
      loadConfig({
        ...validEnvironment,
        NODE_ENV: 'development',
        LOCAL_TEST_AUTH_ENABLED: 'yes',
      }),
    ).toThrow(ZodError);
  });

  it('rejects the local storage provider in production', () => {
    expect(() =>
      loadConfig({
        ...validEnvironment,
        NODE_ENV: 'production',
        STORAGE_PROVIDER: 'local',
      }),
    ).toThrow(/STORAGE_PROVIDER=local is not allowed when NODE_ENV=production/);
  });

  it('allows the local storage provider outside production', () => {
    const config = loadConfig({
      ...validEnvironment,
      STORAGE_PROVIDER: 'local',
    });

    expect(config.storageProvider).toBe('local');
  });

  it('parses a fully configured minio storage provider', () => {
    const config = loadConfig({
      ...validEnvironment,
      STORAGE_PROVIDER: 'minio',
      STORAGE_BUCKET: 'roomscan-assets',
      STORAGE_REGION: 'us-east-1',
      STORAGE_ENDPOINT: 'localhost:9000',
      STORAGE_ACCESS_KEY_ID: 'minio-access-key',
      STORAGE_SECRET_ACCESS_KEY: 'minio-secret-key',
      STORAGE_USE_SSL: 'true',
    });

    expect(config).toMatchObject({
      storageProvider: 'minio',
      storageBucket: 'roomscan-assets',
      storageRegion: 'us-east-1',
      storageEndpoint: 'localhost:9000',
      storageAccessKeyId: 'minio-access-key',
      storageSecretAccessKey: 'minio-secret-key',
      storageUseSsl: true,
    });
  });

  it.each([
    ['STORAGE_BUCKET', ''],
    ['STORAGE_ENDPOINT', ''],
    ['STORAGE_ACCESS_KEY_ID', ''],
    ['STORAGE_SECRET_ACCESS_KEY', ''],
  ])('rejects a minio provider missing %s', (name, value) => {
    expect(() =>
      loadConfig({
        ...validEnvironment,
        STORAGE_PROVIDER: 'minio',
        STORAGE_BUCKET: 'roomscan-assets',
        STORAGE_ENDPOINT: 'localhost:9000',
        STORAGE_ACCESS_KEY_ID: 'minio-access-key',
        STORAGE_SECRET_ACCESS_KEY: 'minio-secret-key',
        [name]: value,
      }),
    ).toThrow(RegExp(`${name} is required when STORAGE_PROVIDER=minio`));
  });

  it('rejects an unknown storage provider', () => {
    expect(() =>
      loadConfig({
        ...validEnvironment,
        STORAGE_PROVIDER: 's3',
      }),
    ).toThrow(ZodError);
  });

  it('accepts staging as NODE_ENV', () => {
    const config = loadConfig({
      ...validEnvironment,
      NODE_ENV: 'staging',
      MAIL_PROVIDER: 'smtp',
      SMTP_HOST: 'sandbox.smtp.mailtrap.io',
      SMTP_USER: 'mailtrap-user',
      SMTP_PASS: 'mailtrap-pass',
    });

    expect(config.nodeEnv).toBe('staging');
  });

  it('supports a wildcard CORS origin', () => {
    const config = loadConfig({
      ...validEnvironment,
      CORS_ORIGIN: '*',
    });

    expect(config.corsOrigins).toBe('*');
  });

  it('parses a trusted proxy hop count', () => {
    const config = loadConfig({
      ...validEnvironment,
      TRUST_PROXY: '1',
    });

    expect(config.trustProxy).toBe(1);
  });

  it('parses trusted proxy addresses, CIDRs, and named subnets', () => {
    const config = loadConfig({
      ...validEnvironment,
      TRUST_PROXY: 'loopback, 10.0.0.0/8, 2001:db8::/32',
    });

    expect(config.trustProxy).toEqual(['loopback', '10.0.0.0/8', '2001:db8::/32']);
  });

  it.each(['true', '0', 'invalid-proxy', '10.0.0.0/33', '2001:db8::/129', 'loopback,'])(
    'rejects an unsafe or invalid TRUST_PROXY value: %s',
    (trustProxy) => {
      expect(() =>
        loadConfig({
          ...validEnvironment,
          TRUST_PROXY: trustProxy,
        }),
      ).toThrow(ZodError);
    },
  );

  it('accepts configured rate limits', () => {
    const config = loadConfig({
      ...validEnvironment,
      RATE_LIMIT_API_WINDOW_SECONDS: '120',
      RATE_LIMIT_API_MAX_REQUESTS: '240',
      RATE_LIMIT_APPLE_AUTH_WINDOW_SECONDS: '600',
      RATE_LIMIT_APPLE_AUTH_MAX_REQUESTS: '12',
    });

    expect(config).toMatchObject({
      apiRateLimitWindowSeconds: 120,
      apiRateLimitMaxRequests: 240,
      appleAuthRateLimitWindowSeconds: 600,
      appleAuthRateLimitMaxRequests: 12,
    });
  });

  it.each([
    ['RATE_LIMIT_API_WINDOW_SECONDS', ''],
    ['RATE_LIMIT_API_WINDOW_SECONDS', '0'],
    ['RATE_LIMIT_API_WINDOW_SECONDS', '-1'],
    ['RATE_LIMIT_API_WINDOW_SECONDS', '1.5'],
    ['RATE_LIMIT_API_WINDOW_SECONDS', '2147484'],
    ['RATE_LIMIT_API_MAX_REQUESTS', '0'],
    ['RATE_LIMIT_API_MAX_REQUESTS', '-1'],
    ['RATE_LIMIT_API_MAX_REQUESTS', '1.5'],
    ['RATE_LIMIT_API_MAX_REQUESTS', '9007199254740992'],
    ['RATE_LIMIT_APPLE_AUTH_WINDOW_SECONDS', '0'],
    ['RATE_LIMIT_APPLE_AUTH_MAX_REQUESTS', '0'],
  ])('rejects an invalid %s value: %s', (name, value) => {
    expect(() =>
      loadConfig({
        ...validEnvironment,
        [name]: value,
      }),
    ).toThrow(ZodError);
  });

  it('rejects a missing database URL', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'test',
      }),
    ).toThrow(ZodError);
  });

  it('rejects a non-PostgreSQL database URL', () => {
    expect(() =>
      loadConfig({
        ...validEnvironment,
        DATABASE_URL: 'mysql://localhost/roomscan',
      }),
    ).toThrow(/postgresql/);
  });

  it('rejects an invalid port', () => {
    expect(() =>
      loadConfig({
        ...validEnvironment,
        PORT: '70000',
      }),
    ).toThrow(ZodError);
  });

  it('rejects a missing Apple client ID', () => {
    const environment: Record<string, string> = { ...validEnvironment };
    delete environment.APPLE_CLIENT_ID;

    expect(() => loadConfig(environment)).toThrow(ZodError);
  });

  it('rejects short authentication secrets', () => {
    expect(() =>
      loadConfig({
        ...validEnvironment,
        AUTH_ACCESS_TOKEN_SECRET: 'too-short',
      }),
    ).toThrow(ZodError);
  });

  it('accepts configured authentication token lifetimes', () => {
    const config = loadConfig({
      ...validEnvironment,
      AUTH_ACCESS_TOKEN_TTL_SECONDS: '600',
      AUTH_REFRESH_TOKEN_TTL_SECONDS: '1200',
    });

    expect(config.accessTokenTtlSeconds).toBe(600);
    expect(config.refreshTokenTtlSeconds).toBe(1200);
  });

  it('requires the refresh token lifetime to exceed the access token lifetime', () => {
    expect(() =>
      loadConfig({
        ...validEnvironment,
        AUTH_ACCESS_TOKEN_TTL_SECONDS: '1200',
        AUTH_REFRESH_TOKEN_TTL_SECONDS: '1200',
      }),
    ).toThrow(/greater than access token TTL/);
  });

  it('parses the configured model size bounds', () => {
    const config = loadConfig({
      ...validEnvironment,
      ASSET_MIN_MODEL_SIZE_BYTES: '20000000',
      ASSET_MAX_MODEL_SIZE_BYTES: '80000000',
    });

    expect(config.assetMinModelSizeBytes).toBe(20_000_000);
    expect(config.assetMaxModelSizeBytes).toBe(80_000_000);
  });

  it('rejects a model size maximum that does not exceed the minimum', () => {
    expect(() =>
      loadConfig({
        ...validEnvironment,
        ASSET_MIN_MODEL_SIZE_BYTES: '50000000',
        ASSET_MAX_MODEL_SIZE_BYTES: '50000000',
      }),
    ).toThrow(/greater than ASSET_MIN_MODEL_SIZE_BYTES/);
  });

  it('parses the configured invitation settings', () => {
    const config = loadConfig({
      ...validEnvironment,
      INVITATION_TTL_SECONDS: '1209600',
      INVITATION_BASE_URL: 'https://invite.roomscan.dev/',
    });

    expect(config.invitationTtlSeconds).toBe(1_209_600);
    expect(config.invitationBaseUrl).toBe('https://invite.roomscan.dev');
  });

  it.each(['', 'not-a-url', '0', '-1', '1.5'])(
    'rejects an invalid invitation TTL or base URL value: %s',
    (value) => {
      expect(() =>
        loadConfig({
          ...validEnvironment,
          INVITATION_TTL_SECONDS: value,
          INVITATION_BASE_URL: value,
        }),
      ).toThrow(ZodError);
    },
  );

  it('parses a fully configured smtp mail provider', () => {
    const config = loadConfig({
      ...validEnvironment,
      MAIL_PROVIDER: 'smtp',
      SMTP_HOST: 'sandbox.smtp.mailtrap.io',
      SMTP_PORT: '2525',
      SMTP_USER: 'mailtrap-user',
      SMTP_PASS: 'mailtrap-pass',
      SMTP_SECURE: 'false',
      MAIL_FROM: 'RoomScan App <notifications@roomscan.app>',
    });

    expect(config).toMatchObject({
      mailProvider: 'smtp',
      smtpHost: 'sandbox.smtp.mailtrap.io',
      smtpPort: 2525,
      smtpUser: 'mailtrap-user',
      smtpPass: 'mailtrap-pass',
      smtpSecure: false,
      mailFrom: 'RoomScan App <notifications@roomscan.app>',
    });
  });

  it.each(['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'])('rejects a smtp provider missing %s', (name) => {
    expect(() =>
      loadConfig({
        ...validEnvironment,
        MAIL_PROVIDER: 'smtp',
        SMTP_HOST: 'sandbox.smtp.mailtrap.io',
        SMTP_USER: 'mailtrap-user',
        SMTP_PASS: 'mailtrap-pass',
        [name]: '',
      }),
    ).toThrow(RegExp(`${name} is required when MAIL_PROVIDER=smtp`));
  });

  it.each(['staging', 'production'])('rejects the log mail provider in NODE_ENV=%s', (nodeEnv) => {
    expect(() =>
      loadConfig({
        ...validEnvironment,
        NODE_ENV: nodeEnv,
        MAIL_PROVIDER: 'log',
      }),
    ).toThrow(/MAIL_PROVIDER=log is only allowed when NODE_ENV is development or test/);
  });

  it.each(['development', 'test'])('allows the log mail provider in NODE_ENV=%s', (nodeEnv) => {
    const config = loadConfig({
      ...validEnvironment,
      NODE_ENV: nodeEnv,
      MAIL_PROVIDER: 'log',
    });

    expect(config.mailProvider).toBe('log');
  });
});
