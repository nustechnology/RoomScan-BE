import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../src/generated/prisma/client.js';
import { LOCAL_TEST_USER_ID } from '../src/config/constants.js';
import {
  LOCAL_TEST_PROJECT_ID,
  LOCAL_TEST_PROJECT_NAME,
  LOCAL_TEST_SCANS,
  seedLocalTestProject,
} from '../src/infrastructure/database/local-test-project-seed.js';

describe('seedLocalTestProject', () => {
  it('idempotently created or refreshes a demo project owned by the local user', async () => {
    const projectUpsert = vi.fn().mockResolvedValue({});
    const scanUpsert = vi.fn().mockResolvedValue({});
    const transaction = vi.fn(async (operation: unknown) => {
      return (
        operation as (tx: {
          project: { upsert: typeof projectUpsert };
          scan: { upsert: typeof scanUpsert };
        }) => Promise<unknown>
      )({
        project: { upsert: projectUpsert },
        scan: { upsert: scanUpsert },
      });
    });
    const client = {
      $transaction: transaction,
    } as unknown as Pick<PrismaClient, '$transaction'>;

    await expect(seedLocalTestProject(client)).resolves.toBeUndefined();

    expect(projectUpsert).toHaveBeenCalledWith({
      where: { id: LOCAL_TEST_PROJECT_ID },
      create: {
        id: LOCAL_TEST_PROJECT_ID,
        name: LOCAL_TEST_PROJECT_NAME,
        description: 'Survey apartment for the local development demo',
        ownerId: LOCAL_TEST_USER_ID,
      },
      update: {
        name: LOCAL_TEST_PROJECT_NAME,
        description: 'Survey apartment for the local development demo',
        deletedAt: null,
      },
    });

    expect(scanUpsert).toHaveBeenCalledTimes(LOCAL_TEST_SCANS.length);
    for (const scan of LOCAL_TEST_SCANS) {
      expect(scanUpsert).toHaveBeenCalledWith({
        where: { id: scan.id },
        create: {
          id: scan.id,
          projectId: LOCAL_TEST_PROJECT_ID,
          createdById: LOCAL_TEST_USER_ID,
          name: scan.name,
          description: scan.description,
          thumbnail: scan.thumbnail,
          assetStatus: scan.assetStatus,
          syncStatus: scan.syncStatus,
          modelVersion: scan.modelVersion,
        },
        update: {
          name: scan.name,
          description: scan.description,
          thumbnail: scan.thumbnail,
          assetStatus: scan.assetStatus,
          syncStatus: scan.syncStatus,
          modelVersion: scan.modelVersion,
          deletedAt: null,
        },
      });
    }

    expect(transaction).toHaveBeenCalledOnce();
  });
});
