import { AssetStatus, SyncStatus } from '../../generated/prisma/enums.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { LOCAL_TEST_USER_ID, LOCAL_TEST_VIEWER_ID } from '../../config/constants.js';
import { generateInvitationToken, hashInvitationToken } from '../../modules/share/share.service.js';

export const LOCAL_TEST_PROJECT_ID = '00000000-0000-4000-8000-000000000101';
export const LOCAL_TEST_PROJECT_NAME = 'District 2 Apartment';
export const LOCAL_TEST_INVITATION_ID = '00000000-0000-4000-8000-000000000401';

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

export const LOCAL_TEST_NOTES = [
  {
    id: '00000000-0000-4000-8000-000000000301',
    scanId: '00000000-0000-4000-8000-000000000201',
    content: 'Cabinet hinge on the island is loose',
    color: 'YELLOW',
    position: { x: 1.25, y: -0.5, z: 0.75 },
    orientation: { x: 0, y: 0, z: 1 },
    modelVersion: '1',
  },
  {
    id: '00000000-0000-4000-8000-000000000302',
    scanId: '00000000-0000-4000-8000-000000000201',
    content: 'Replace the recessed downlights',
    color: 'BLUE',
    position: { x: 2.0, y: 1.5, z: 2.4 },
    orientation: null,
    modelVersion: '1',
  },
  {
    id: '00000000-0000-4000-8000-000000000303',
    scanId: '00000000-0000-4000-8000-000000000202',
    content: 'Window handle needs tightening',
    color: 'RED',
    position: { x: -1.1, y: 0.2, z: 1.3 },
    orientation: { x: 0, y: 0, z: 1 },
    modelVersion: '1',
  },
  {
    id: '00000000-0000-4000-8000-000000000304',
    scanId: '00000000-0000-4000-8000-000000000203',
    content: 'Consider an extra countertop outlet',
    color: 'ORANGE',
    position: { x: 0.4, y: -0.3, z: 0.9 },
    orientation: null,
    modelVersion: '1',
  },
] as const;

type SeedClient = Pick<PrismaClient, '$transaction'>;

export async function seedLocalTestProject(client: SeedClient): Promise<{ invitationUrl: string }> {
  let invitationUrl = '';
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
        deletedAt: null,
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
          deletedAt: null,
        },
      });
    }

    for (const note of LOCAL_TEST_NOTES) {
      await transaction.note.upsert({
        where: { id: note.id },
        create: {
          id: note.id,
          scanId: note.scanId,
          createdById: LOCAL_TEST_USER_ID,
          content: note.content,
          color: note.color,
          position: note.position,
          orientation: note.orientation === null ? Prisma.JsonNull : note.orientation,
          modelVersion: note.modelVersion,
        },
        update: {
          scanId: note.scanId,
          content: note.content,
          color: note.color,
          position: note.position,
          orientation: note.orientation === null ? Prisma.JsonNull : note.orientation,
          modelVersion: note.modelVersion,
        },
      });
    }

    await transaction.projectAccess.upsert({
      where: {
        projectId_userId: {
          projectId: LOCAL_TEST_PROJECT_ID,
          userId: LOCAL_TEST_VIEWER_ID,
        },
      },
      create: {
        projectId: LOCAL_TEST_PROJECT_ID,
        userId: LOCAL_TEST_VIEWER_ID,
        role: 'VIEWER',
        acceptedAt: new Date(),
        declinedAt: null,
        revokedAt: null,
      },
      update: {
        role: 'VIEWER',
        acceptedAt: new Date(),
        declinedAt: null,
        revokedAt: null,
      },
    });

    const rawToken = generateInvitationToken();
    await transaction.invitation.upsert({
      where: { id: LOCAL_TEST_INVITATION_ID },
      create: {
        id: LOCAL_TEST_INVITATION_ID,
        projectId: LOCAL_TEST_PROJECT_ID,
        createdById: LOCAL_TEST_USER_ID,
        tokenHash: hashInvitationToken(rawToken),
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        sentAt: new Date(),
      },
      update: {
        projectId: LOCAL_TEST_PROJECT_ID,
        createdById: LOCAL_TEST_USER_ID,
        tokenHash: hashInvitationToken(rawToken),
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        sentAt: new Date(),
        revokedAt: null,
      },
    });

    invitationUrl = `http://localhost:3000/invitations/${rawToken}`;
  });

  return { invitationUrl };
}
