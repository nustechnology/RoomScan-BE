import 'dotenv/config';

import { loadConfig } from '../config/env.js';
import { createPrismaClient } from '../infrastructure/database/prisma.js';
import { PrismaIdempotencyExecutor } from '../infrastructure/database/prisma-idempotency.js';
import { PrismaScanAssetRepository } from '../infrastructure/database/prisma-scan-asset-repository.js';
import { SyncCrypto } from '../infrastructure/crypto/sync-crypto.js';
import { createLogger } from '../infrastructure/logging/logger.js';
import { createStorageAdapter } from '../infrastructure/storage/storage-factory.js';
import { runOrphanAssetCleanupJob } from './orphan-asset-cleanup.job.js';

const config = loadConfig();
const logger = createLogger(config);
const prismaClient = createPrismaClient(config.databaseUrl);
const syncCrypto = new SyncCrypto(config.syncCryptoKey);
const idempotency = new PrismaIdempotencyExecutor(prismaClient, syncCrypto);
const scanAssetRepository = new PrismaScanAssetRepository(prismaClient, idempotency);
const storage = createStorageAdapter(config);

try {
  await runOrphanAssetCleanupJob({
    scanAssetRepository,
    storage,
    graceSeconds: config.uploadSessionExpiryGraceSeconds,
    batchSize: config.orphanAssetCleanupBatchSize,
    logger,
  });
  process.exitCode = 0;
} catch (error) {
  logger.error({ err: error }, 'Orphan-asset cleanup job failed');
  process.exitCode = 1;
} finally {
  await prismaClient.$disconnect();
}
