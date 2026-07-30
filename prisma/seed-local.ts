import 'dotenv/config';

import { loadConfig } from '../src/config/env.js';
import { seedLocalTestUser } from '../src/infrastructure/database/local-test-user-seed.js';
import { createPrismaClient } from '../src/infrastructure/database/prisma.js';

const config = loadConfig();

if (config.nodeEnv !== 'development') {
  throw new Error('The local test user seed may only run when NODE_ENV=development');
}

const client = createPrismaClient(config.databaseUrl);

try {
  const user = await seedLocalTestUser(client);
  console.info(`Local test user ready: ${user.id}`);
} finally {
  await client.$disconnect();
}
