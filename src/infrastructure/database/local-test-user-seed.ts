import { AuthProvider } from '../../generated/prisma/enums.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import {
  LOCAL_TEST_APPLE_PROVIDER_ID,
  LOCAL_TEST_USER_EMAIL,
  LOCAL_TEST_USER_ID,
  LOCAL_TEST_VIEWER_EMAIL,
  LOCAL_TEST_VIEWER_ID,
} from '../../config/constants.js';
import type { CurrentUser } from '../../common/middleware/authenticate.js';

export async function seedLocalTestUser(client: Pick<PrismaClient, 'user'>): Promise<CurrentUser> {
  return await client.user.upsert({
    where: {
      provider_providerId: {
        provider: AuthProvider.APPLE,
        providerId: LOCAL_TEST_APPLE_PROVIDER_ID,
      },
    },
    create: {
      id: LOCAL_TEST_USER_ID,
      provider: AuthProvider.APPLE,
      providerId: LOCAL_TEST_APPLE_PROVIDER_ID,
      email: LOCAL_TEST_USER_EMAIL,
      emailVerified: true,
    },
    update: {
      email: LOCAL_TEST_USER_EMAIL,
      emailVerified: true,
    },
    select: {
      id: true,
      email: true,
    },
  });
}

export async function seedLocalTestViewer(
  client: Pick<PrismaClient, 'user'>,
): Promise<CurrentUser> {
  return await client.user.upsert({
    where: {
      provider_providerId: {
        provider: AuthProvider.APPLE,
        providerId: `${LOCAL_TEST_VIEWER_ID}-viewer`,
      },
    },
    create: {
      id: LOCAL_TEST_VIEWER_ID,
      provider: AuthProvider.APPLE,
      providerId: `${LOCAL_TEST_VIEWER_ID}-viewer`,
      email: LOCAL_TEST_VIEWER_EMAIL,
      emailVerified: true,
    },
    update: {
      email: LOCAL_TEST_VIEWER_EMAIL,
      emailVerified: true,
    },
    select: {
      id: true,
      email: true,
    },
  });
}
