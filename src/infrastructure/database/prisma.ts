import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../../generated/prisma/client.js';
import type { DatabaseHealth } from './database.js';

export class PrismaDatabase implements DatabaseHealth {
  readonly #client: PrismaClient;

  constructor(connectionString: string) {
    const adapter = new PrismaPg({ connectionString });
    this.#client = new PrismaClient({ adapter });
  }

  async checkConnection(): Promise<void> {
    await this.#client.$queryRaw`SELECT 1`;
  }

  async disconnect(): Promise<void> {
    await this.#client.$disconnect();
  }
}
