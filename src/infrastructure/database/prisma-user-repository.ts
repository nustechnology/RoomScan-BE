import { AuthProvider } from '../../generated/prisma/enums.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import type {
  AppleUserRepository,
  AuthenticatedUser,
  VerifiedAppleIdentity,
} from '../../modules/auth/auth.types.js';

export class PrismaAppleUserRepository implements AppleUserRepository {
  readonly #client: Pick<PrismaClient, 'user'>;

  constructor(client: Pick<PrismaClient, 'user'>) {
    this.#client = client;
  }

  async upsertAppleUser(identity: VerifiedAppleIdentity): Promise<AuthenticatedUser> {
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
        email: identity.email,
        emailVerified: identity.emailVerified,
      },
      update:
        identity.email === null
          ? {}
          : {
              email: identity.email,
              emailVerified: identity.emailVerified,
            },
      select: {
        id: true,
        email: true,
      },
    });

    return {
      id: user.id,
      email: user.email,
      provider: 'apple',
    };
  }
}
