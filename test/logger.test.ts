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
