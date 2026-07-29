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
    appleClientId: 'com.example.roomscan',
    accessTokenSecret: 'access-secret-that-is-at-least-32-characters',
    refreshTokenSecret: 'refresh-secret-that-is-at-least-32-characters',
    accessTokenTtlSeconds: 3600,
    refreshTokenTtlSeconds: 2_592_000,
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
