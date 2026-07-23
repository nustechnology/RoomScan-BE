import pino, { type Logger } from 'pino';

import type { AppConfig } from '../../config/env.js';

export function createLogger(config: AppConfig): Logger {
  return pino({
    enabled: config.logLevel !== 'silent',
    level: config.logLevel === 'silent' ? 'info' : config.logLevel,
    base: {
      service: 'roomscan-backend',
      environment: config.nodeEnv,
    },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'request.headers.authorization',
        'request.headers.cookie',
        'databaseUrl',
        'DATABASE_URL',
      ],
      censor: '[REDACTED]',
    },
  });
}
