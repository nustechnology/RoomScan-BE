import { AuthProvider } from '../../generated/prisma/enums.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import {
  LOCAL_TEST_APPLE_PROVIDER_ID,
  LOCAL_TEST_USER_EMAIL,
  LOCAL_TEST_USER_ID,
  LOCAL_TEST_USER_PUBLIC_ID,
  LOCAL_TEST_VIEWER_EMAIL,
  LOCAL_TEST_VIEWER_ID,
  LOCAL_TEST_VIEWER_PUBLIC_ID,
} from '../../config/constants.js';
import type { CurrentUser } from '../../common/middleware/authenticate.js';

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

export async function seedLocalTestUser(client: Pick<PrismaClient, 'user'>): Promise<CurrentUser> {
  const user = await client.user.upsert({
    where: {
      provider_providerId: {
        provider: AuthProvider.APPLE,
        providerId: LOCAL_TEST_APPLE_PROVIDER_ID,
      },
    },
    create: {
      id: LOCAL_TEST_USER_ID,
      publicId: LOCAL_TEST_USER_PUBLIC_ID,
      provider: AuthProvider.APPLE,
      providerId: LOCAL_TEST_APPLE_PROVIDER_ID,
      email: LOCAL_TEST_USER_EMAIL,
      emailVerified: true,
      displayName: 'RoomScan User',
    },
    update: {
      publicId: LOCAL_TEST_USER_PUBLIC_ID,
      email: LOCAL_TEST_USER_EMAIL,
      emailVerified: true,
      displayName: 'RoomScan User',
    },
    select: {
      id: true,
      publicId: true,
      email: true,
      displayName: true,
    },
  });

  return toCurrentUser(user);
}

export async function seedLocalTestViewer(
  client: Pick<PrismaClient, 'user'>,
): Promise<CurrentUser> {
  const user = await client.user.upsert({
    where: {
      provider_providerId: {
        provider: AuthProvider.APPLE,
        providerId: `${LOCAL_TEST_VIEWER_ID}-viewer`,
      },
    },
    create: {
      id: LOCAL_TEST_VIEWER_ID,
      publicId: LOCAL_TEST_VIEWER_PUBLIC_ID,
      provider: AuthProvider.APPLE,
      providerId: `${LOCAL_TEST_VIEWER_ID}-viewer`,
      email: LOCAL_TEST_VIEWER_EMAIL,
      emailVerified: true,
      displayName: 'Invited Viewer',
    },
    update: {
      publicId: LOCAL_TEST_VIEWER_PUBLIC_ID,
      email: LOCAL_TEST_VIEWER_EMAIL,
      emailVerified: true,
      displayName: 'Invited Viewer',
    },
    select: {
      id: true,
      publicId: true,
      email: true,
      displayName: true,
    },
  });

  return toCurrentUser(user);
}
