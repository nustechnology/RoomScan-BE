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
      appleClientId: 'com.example.roomscan',
      accessTokenSecret: 'access-secret-that-is-at-least-32-characters',
      refreshTokenSecret: 'refresh-secret-that-is-at-least-32-characters',
      accessTokenTtlSeconds: 3600,
      refreshTokenTtlSeconds: 2_592_000,
    });
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
});
