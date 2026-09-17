import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../src/generated/prisma/client.js';
import {
  LOCAL_TEST_APPLE_PROVIDER_ID,
  LOCAL_TEST_USER_EMAIL,
  LOCAL_TEST_USER_ID,
  LOCAL_TEST_USER_PUBLIC_ID,
  LOCAL_TEST_VIEWER_EMAIL,
  LOCAL_TEST_VIEWER_ID,
  LOCAL_TEST_VIEWER_PUBLIC_ID,
} from '../src/config/constants.js';
import {
  seedLocalTestUser,
  seedLocalTestViewer,
} from '../src/infrastructure/database/local-test-user-seed.js';

describe('seedLocalTestUser', () => {
  it('idempotently creates or refreshes the fixed local Apple user', async () => {
    const upsert = vi.fn().mockResolvedValue({
      id: LOCAL_TEST_USER_ID,
      publicId: LOCAL_TEST_USER_PUBLIC_ID,
      email: LOCAL_TEST_USER_EMAIL,
      displayName: 'RoomScan User',
    });
    const client = {
      user: { upsert },
    } as unknown as Pick<PrismaClient, 'user'>;

    await expect(seedLocalTestUser(client)).resolves.toEqual({
      id: LOCAL_TEST_USER_ID,
      publicUserId: LOCAL_TEST_USER_PUBLIC_ID,
      email: LOCAL_TEST_USER_EMAIL,
      displayName: 'RoomScan User',
    });
    expect(upsert).toHaveBeenCalledWith({
      where: {
        provider_providerId: {
          provider: 'APPLE',
          providerId: LOCAL_TEST_APPLE_PROVIDER_ID,
        },
      },
      create: {
        id: LOCAL_TEST_USER_ID,
        publicId: LOCAL_TEST_USER_PUBLIC_ID,
        provider: 'APPLE',
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
  });

  it('idempotently creates or refreshes the fixed local demo viewer', async () => {
    const upsert = vi.fn().mockResolvedValue({
      id: LOCAL_TEST_VIEWER_ID,
      publicId: LOCAL_TEST_VIEWER_PUBLIC_ID,
      email: LOCAL_TEST_VIEWER_EMAIL,
      displayName: 'Invited Viewer',
    });
    const client = {
      user: { upsert },
    } as unknown as Pick<PrismaClient, 'user'>;

    await expect(seedLocalTestViewer(client)).resolves.toEqual({
      id: LOCAL_TEST_VIEWER_ID,
      publicUserId: LOCAL_TEST_VIEWER_PUBLIC_ID,
      email: LOCAL_TEST_VIEWER_EMAIL,
      displayName: 'Invited Viewer',
    });
    expect(upsert).toHaveBeenCalledWith({
      where: {
        provider_providerId: {
          provider: 'APPLE',
          providerId: `${LOCAL_TEST_VIEWER_ID}-viewer`,
        },
      },
      create: {
        id: LOCAL_TEST_VIEWER_ID,
        publicId: LOCAL_TEST_VIEWER_PUBLIC_ID,
        provider: 'APPLE',
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
  });
});
