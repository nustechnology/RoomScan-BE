import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../../generated/prisma/client.js';
import type { DatabaseHealth } from './database.js';

export function createPrismaClient(connectionString: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

export class PrismaDatabase implements DatabaseHealth {
  readonly #client: PrismaClient;

  constructor(client: PrismaClient) {
    this.#client = client;
  }

  async checkConnection(): Promise<void> {
    await this.#client.$queryRaw`SELECT 1`;
  }

  async disconnect(): Promise<void> {
    await this.#client.$disconnect();
  }
}
