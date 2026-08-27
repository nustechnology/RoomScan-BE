import 'dotenv/config';

import { loadConfig } from '../config/env.js';
import { createPrismaClient } from '../infrastructure/database/prisma.js';
import { PrismaIdempotencyExecutor } from '../infrastructure/database/prisma-idempotency.js';
import { PrismaShareRepository } from '../infrastructure/database/prisma-share-repository.js';
import { SyncCrypto } from '../infrastructure/crypto/sync-crypto.js';
import { createLogger } from '../infrastructure/logging/logger.js';
import { runInvitationExpiryJob } from './invitation-expiry.job.js';

const config = loadConfig();
const logger = createLogger(config);
const prismaClient = createPrismaClient(config.databaseUrl);
const syncCrypto = new SyncCrypto(config.syncCryptoKey);
const idempotency = new PrismaIdempotencyExecutor(prismaClient, syncCrypto);
const shareRepository = new PrismaShareRepository(prismaClient, idempotency);

try {
  await runInvitationExpiryJob({ shareRepository, logger });
  process.exitCode = 0;
} catch (error) {
  logger.error({ err: error }, 'Invitation expiry job failed');
  process.exitCode = 1;
} finally {
  await prismaClient.$disconnect();
}
