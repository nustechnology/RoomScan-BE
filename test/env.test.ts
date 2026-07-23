import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { loadConfig } from '../src/config/env.js';

const validEnvironment = {
  NODE_ENV: 'test',
  PORT: '4000',
  DATABASE_URL: 'postgresql://roomscan:roomscan@localhost:5432/roomscan',
  LOG_LEVEL: 'silent',
  CORS_ORIGIN: 'https://app.roomscan.dev, https://admin.roomscan.dev',
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
});
