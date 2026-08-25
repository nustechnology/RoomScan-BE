import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import type { CurrentUser, CurrentUserRepository } from '../../common/middleware/authenticate.js';

export class PrismaCurrentUserRepository implements CurrentUserRepository {
  readonly #client: Pick<PrismaClient, 'user'>;

  constructor(client: Pick<PrismaClient, 'user'>) {
    this.#client = client;
  }

  async findById(userId: string): Promise<CurrentUser | null> {
    return await this.#client.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
      },
    });
  }

  async updateDisplayName(userId: string, displayName: string | null): Promise<CurrentUser | null> {
    try {
      return await this.#client.user.update({
        where: { id: userId },
        data: { displayName },
        select: {
          id: true,
          email: true,
          displayName: true,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return null;
      }
      throw error;
    }
  }
}
