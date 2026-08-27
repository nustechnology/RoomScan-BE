import 'dotenv/config';

import { loadConfig } from '../config/env.js';
import { createPrismaClient } from '../infrastructure/database/prisma.js';
import { PrismaIdempotencyExecutor } from '../infrastructure/database/prisma-idempotency.js';
import { PrismaScanAssetRepository } from '../infrastructure/database/prisma-scan-asset-repository.js';
import { SyncCrypto } from '../infrastructure/crypto/sync-crypto.js';
import { createLogger } from '../infrastructure/logging/logger.js';
import { runUploadSessionExpiryJob } from './upload-session-expiry.job.js';

const config = loadConfig();
const logger = createLogger(config);
const prismaClient = createPrismaClient(config.databaseUrl);
const syncCrypto = new SyncCrypto(config.syncCryptoKey);
const idempotency = new PrismaIdempotencyExecutor(prismaClient, syncCrypto);
const scanAssetRepository = new PrismaScanAssetRepository(prismaClient, idempotency);

try {
  await runUploadSessionExpiryJob({
    scanAssetRepository,
    graceSeconds: config.uploadSessionExpiryGraceSeconds,
    logger,
  });
  process.exitCode = 0;
} catch (error) {
  logger.error({ err: error }, 'Upload-session expiry job failed');
  process.exitCode = 1;
} finally {
  await prismaClient.$disconnect();
}
