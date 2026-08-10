import type { PrismaClient } from '../../generated/prisma/client.js';
import type { RefreshTokenRepository } from '../../modules/auth/auth.types.js';

export class PrismaRefreshTokenRepository implements RefreshTokenRepository {
  readonly #client: Pick<PrismaClient, 'refreshToken' | '$transaction'>;

  constructor(client: Pick<PrismaClient, 'refreshToken' | '$transaction'>) {
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

  async consume(jti: string): Promise<boolean> {
    const result = await this.#client.refreshToken.updateMany({
      where: { jti, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { revokedAt: new Date() },
    });

    return result.count > 0;
  }

  async rotate(oldJti: string, newJti: string, userId: string, expiresAt: Date): Promise<boolean> {
    return this.#client.$transaction(async (tx) => {
      const result = await tx.refreshToken.updateMany({
        where: { jti: oldJti, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { revokedAt: new Date() },
      });

      if (result.count === 0) {
        return false;
      }

      await tx.refreshToken.create({
        data: { jti: newJti, userId, expiresAt },
      });

      return true;
    });
  }
}
