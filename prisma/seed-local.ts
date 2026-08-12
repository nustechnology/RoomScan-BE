import 'dotenv/config';

import { loadConfig } from '../src/config/env.js';
import { seedLocalTestProject } from '../src/infrastructure/database/local-test-project-seed.js';
import {
  seedLocalTestUser,
  seedLocalTestViewer,
} from '../src/infrastructure/database/local-test-user-seed.js';
import { createPrismaClient } from '../src/infrastructure/database/prisma.js';

const config = loadConfig();

if (config.nodeEnv !== 'development') {
  throw new Error('The local test user seed may only run when NODE_ENV=development');
}

const client = createPrismaClient(config.databaseUrl);

try {
  const user = await seedLocalTestUser(client);
  console.info(`Local test user ready: ${user.id}`);
  const viewer = await seedLocalTestViewer(client);
  console.info(`Local test viewer ready: ${viewer.id}`);
  const { invitationUrl } = await seedLocalTestProject(client);
  console.info('Local test projects and scans ready');
  console.info(`Demo invitation link: ${invitationUrl}`);
} finally {
  await client.$disconnect();
}
