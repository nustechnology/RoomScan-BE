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

  async consume(jti: string): Promise<boolean> {
    const result = await this.#client.refreshToken.updateMany({
      where: { jti, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { revokedAt: new Date() },
    });

    return result.count > 0;
  }
}
