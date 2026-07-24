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
      appleClientId: 'com.example.roomscan',
      accessTokenSecret: 'access-secret-that-is-at-least-32-characters',
      refreshTokenSecret: 'refresh-secret-that-is-at-least-32-characters',
      accessTokenTtlSeconds: 900,
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
