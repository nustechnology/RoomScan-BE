import pino, { type Logger, type DestinationStream } from 'pino';

import type { AppConfig } from '../../config/env.js';

export function createLogger(config: AppConfig, destination?: DestinationStream): Logger {
  const options = {
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
        'storageKey',
        'signedUrl',
        'downloadUrl',
        'uploadUrl',
        'connectionString',
      ],
      censor: '[REDACTED]',
    },
  };
  return destination === undefined ? pino(options) : pino(options, destination);
}
