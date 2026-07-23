import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import { PrismaDatabase } from './infrastructure/database/prisma.js';
import { createLogger } from './infrastructure/logging/logger.js';

const config = loadConfig();
const logger = createLogger(config);
const database = new PrismaDatabase(config.databaseUrl);
const app = createApp({ config, database, logger });

let isShuttingDown = false;

async function shutdown(signal: string, exitCode: number): Promise<void> {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  logger.info({ signal }, 'Shutting down RoomScan API');

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve();
    });
  });
  await database.disconnect();
  process.exitCode = exitCode;
}

const server = app.listen(config.port, () => {
  logger.info({ port: config.port }, 'RoomScan API is listening');
});

process.once('SIGINT', () => {
  void shutdown('SIGINT', 0);
});
process.once('SIGTERM', () => {
  void shutdown('SIGTERM', 0);
});
process.once('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Uncaught exception');
  void shutdown('uncaughtException', 1);
});
process.once('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'Unhandled promise rejection');
  void shutdown('unhandledRejection', 1);
});
