import { AssetStatus, SyncStatus } from '../../generated/prisma/enums.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { LOCAL_TEST_USER_ID } from '../../config/constants.js';

export const LOCAL_TEST_PROJECT_ID = '00000000-0000-4000-8000-000000000101';
export const LOCAL_TEST_PROJECT_NAME = 'District 2 Apartment';

export const LOCAL_TEST_SCANS = [
  {
    id: '00000000-0000-4000-8000-000000000201',
    name: 'Living Room',
    description: 'Open-plan living and dining area',
    thumbnail: null,
    assetStatus: AssetStatus.UPLOADED,
    syncStatus: SyncStatus.SYNCED,
    modelVersion: 1,
  },
  {
    id: '00000000-0000-4000-8000-000000000202',
    name: 'Main Bedroom',
    description: 'Master bedroom with balcony access',
    thumbnail: null,
    assetStatus: AssetStatus.UPLOADING,
    syncStatus: SyncStatus.SYNCING,
    modelVersion: 1,
  },
  {
    id: '00000000-0000-4000-8000-000000000203',
    name: 'Kitchen',
    description: null,
    thumbnail: null,
    assetStatus: AssetStatus.UPLOADED,
    syncStatus: SyncStatus.SYNCED,
    modelVersion: 1,
  },
  {
    id: '00000000-0000-4000-8000-000000000204',
    name: 'Balcony',
    description: null,
    thumbnail: null,
    assetStatus: AssetStatus.FAILED,
    syncStatus: SyncStatus.FAILED,
    modelVersion: 1,
  },
] as const;

type SeedClient = Pick<PrismaClient, '$transaction'>;

export async function seedLocalTestProject(client: SeedClient): Promise<void> {
  await client.$transaction(async (transaction) => {
    await transaction.project.upsert({
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
      },
    });

    for (const scan of LOCAL_TEST_SCANS) {
      await transaction.scan.upsert({
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
        },
      });
    }
  });
}
