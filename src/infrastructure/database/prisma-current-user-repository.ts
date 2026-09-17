import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import type { CurrentUser, CurrentUserRepository } from '../../common/middleware/authenticate.js';

function toCurrentUser(row: {
  id: string;
  publicId: string;
  email: string | null;
  displayName: string | null;
}): CurrentUser {
  return {
    id: row.id,
    publicUserId: row.publicId,
    email: row.email,
    displayName: row.displayName,
  };
}

export class PrismaCurrentUserRepository implements CurrentUserRepository {
  readonly #client: Pick<PrismaClient, 'user'>;

  constructor(client: Pick<PrismaClient, 'user'>) {
    this.#client = client;
  }

  async findById(userId: string): Promise<CurrentUser | null> {
    const user = await this.#client.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        publicId: true,
        email: true,
        displayName: true,
      },
    });

    return user === null ? null : toCurrentUser(user);
  }

  async updateDisplayName(userId: string, displayName: string | null): Promise<CurrentUser | null> {
    try {
      const user = await this.#client.user.update({
        where: { id: userId },
        data: { displayName },
        select: {
          id: true,
          publicId: true,
          email: true,
          displayName: true,
        },
      });

      return toCurrentUser(user);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return null;
      }
      throw error;
    }
  }
}
