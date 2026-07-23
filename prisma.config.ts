import 'dotenv/config';

import { defineConfig } from 'prisma/config';

const buildTimeDatabaseUrl = 'postgresql://roomscan:roomscan@localhost:5432/roomscan?schema=public';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? buildTimeDatabaseUrl,
  },
});
