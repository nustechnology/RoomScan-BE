import { generatePublicUserId } from '../../common/identifiers/public-user-id.js';
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { AuthProvider } from '../../generated/prisma/enums.js';
import type {
  AppleUserRepository,
  AuthenticatedUser,
  VerifiedAppleIdentity,
} from '../../modules/auth/auth.types.js';

/**
 * A generated public id collides only by chance (30^10), so a handful of retries
 * is enough; exhausting them means something else is wrong and must surface.
 */
const PUBLIC_ID_ATTEMPTS = 5;

function isPublicIdCollision(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }

  const target = error.meta?.['target'];

  if (Array.isArray(target)) {
    return target.includes('publicId');
  }

  return typeof target === 'string' && target.includes('publicId');
}

export class PrismaAppleUserRepository implements AppleUserRepository {
  readonly #client: Pick<PrismaClient, 'user'>;

  constructor(client: Pick<PrismaClient, 'user'>) {
    this.#client = client;
  }

  async upsertAppleUser(identity: VerifiedAppleIdentity): Promise<AuthenticatedUser> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        const user = await this.#client.user.upsert({
          where: {
            provider_providerId: {
              provider: AuthProvider.APPLE,
              providerId: identity.providerId,
            },
          },
          create: {
            provider: AuthProvider.APPLE,
            providerId: identity.providerId,
            publicId: generatePublicUserId(),
            email: identity.email,
            emailVerified: identity.emailVerified,
            ...(identity.displayName === undefined || identity.displayName === null
              ? {}
              : { displayName: identity.displayName }),
          },
          update: {
            ...(identity.email === null
              ? {}
              : {
                  email: identity.email,
                  emailVerified: identity.emailVerified,
                }),
            ...(identity.displayName === undefined || identity.displayName === null
              ? {}
              : { displayName: identity.displayName }),
          },
          select: {
            id: true,
            publicId: true,
            email: true,
            displayName: true,
          },
        });

        return {
          id: user.id,
          publicUserId: user.publicId,
          email: user.email,
          displayName: user.displayName,
          provider: 'apple',
        };
      } catch (error) {
        if (attempt >= PUBLIC_ID_ATTEMPTS || !isPublicIdCollision(error)) {
          throw error;
        }
      }
    }
  }
}
