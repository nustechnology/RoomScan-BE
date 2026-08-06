import type { PrismaClient } from '../../generated/prisma/client.js';
import type { RefreshTokenRepository } from '../../modules/auth/auth.types.js';

export class PrismaRefreshTokenRepository implements RefreshTokenRepository {
  readonly #client: Pick<PrismaClient, 'refreshToken'>;

  constructor(client: Pick<PrismaClient, 'refreshToken'>) {
    this.#client = client;
  }

  async saveToken(jti: string, userId: string, expiresAt: Date): Promise<void> {
    await this.#client.refreshToken.create({
      data: {
        jti,
        userId,
        expiresAt,
      },
    });
  }

  async findActiveByJti(jti: string): Promise<{ userId: string; expiresAt: Date } | null> {
    const record = await this.#client.refreshToken.findFirst({
      where: { jti, revokedAt: null },
      select: {
        userId: true,
        expiresAt: true,
      },
    });

    if (record === null || record.expiresAt <= new Date()) {
      return null;
    }

    return record;
  }

  async revokeByJti(jti: string): Promise<void> {
    await this.#client.refreshToken.updateMany({
      where: { jti, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
