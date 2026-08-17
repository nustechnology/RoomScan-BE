import { AssetStatus, SyncStatus } from '../../generated/prisma/enums.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { LOCAL_TEST_USER_ID, LOCAL_TEST_VIEWER_ID } from '../../config/constants.js';
import { generateInvitationToken, hashInvitationToken } from '../../modules/share/share.service.js';
import {
  resetProjectSyncState,
  writeAccessUpsert,
  writeProjectBootstrap,
} from './prisma-sync-writer.js';

export const LOCAL_TEST_PROJECT_ID = '00000000-0000-4000-8000-000000000101';
export const LOCAL_TEST_PROJECT_NAME = 'District 2 Apartment';
export const LOCAL_TEST_INVITATION_ID = '00000000-0000-4000-8000-000000000401';
export const LOCAL_TEST_PENDING_INVITE_EMAIL = 'pending-invite@roomscan.dev';
export const LOCAL_TEST_SHARED_PROJECT_ID = '00000000-0000-4000-8000-000000000104';
export const LOCAL_TEST_SHARED_PROJECT_NAME = 'Garden House';
export const LOCAL_TEST_SHARED_SCAN_ID = '00000000-0000-4000-8000-000000000208';

const LOCAL_TEST_DELETED_AT = new Date('2026-08-01T00:00:00.000Z');

interface LocalTestSharedProjectSeed {
  id: string;
  name: string;
  description: string;
  projectDeletedAt: Date | null;
  accessRevokedAt: Date | null;
  scan: {
    id: string;
    name: string;
  };
}

export const LOCAL_TEST_SHARED_PROJECTS: LocalTestSharedProjectSeed[] = [
  {
    id: LOCAL_TEST_SHARED_PROJECT_ID,
    name: LOCAL_TEST_SHARED_PROJECT_NAME,
    description: 'Shared demo project owned by the local test viewer',
    projectDeletedAt: null,
    accessRevokedAt: null,
    scan: {
      id: LOCAL_TEST_SHARED_SCAN_ID,
      name: 'Garden Studio',
    },
  },
  {
    id: '00000000-0000-4000-8000-000000000105',
    name: 'Maple Cottage',
    description: 'Shared demo project whose access was revoked by the owner',
    projectDeletedAt: null,
    accessRevokedAt: LOCAL_TEST_DELETED_AT,
    scan: {
      id: '00000000-0000-4000-8000-000000000209',
      name: 'Cottage Living Room',
    },
  },
  {
    id: '00000000-0000-4000-8000-000000000106',
    name: 'Willow Townhouse',
    description: 'Shared demo project that was deleted by its owner',
    projectDeletedAt: LOCAL_TEST_DELETED_AT,
    accessRevokedAt: LOCAL_TEST_DELETED_AT,
    scan: {
      id: '00000000-0000-4000-8000-000000000210',
      name: 'Townhouse Study',
    },
  },
  {
    id: '00000000-0000-4000-8000-000000000107',
    name: 'Cedar Bungalow',
    description: 'Shared demo project in an inconsistent deleted-with-active-access state',
    projectDeletedAt: LOCAL_TEST_DELETED_AT,
    accessRevokedAt: null,
    scan: {
      id: '00000000-0000-4000-8000-000000000211',
      name: 'Bungalow Conservatory',
    },
  },
];

interface LocalTestProjectSeed {
  id: string;
  name: string;
  description: string;
  scans: Array<{
    id: string;
    name: string;
    description: string | null;
    thumbnail: string | null;
    assetStatus: AssetStatus;
    syncStatus: SyncStatus;
    modelVersion: number;
  }>;
}

export const LOCAL_TEST_PROJECTS: LocalTestProjectSeed[] = [
  {
    id: LOCAL_TEST_PROJECT_ID,
    name: LOCAL_TEST_PROJECT_NAME,
    description: 'Survey apartment for the local development demo',
    scans: [
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
    ],
  },
  {
    id: '00000000-0000-4000-8000-000000000102',
    name: 'Riverside Loft',
    description: 'Industrial loft conversion for the local development demo',
    scans: [
      {
        id: '00000000-0000-4000-8000-000000000205',
        name: 'Open Kitchen',
        description: 'Kitchen island with exposed brick',
        thumbnail: null,
        assetStatus: AssetStatus.UPLOADED,
        syncStatus: SyncStatus.SYNCED,
        modelVersion: 1,
      },
      {
        id: '00000000-0000-4000-8000-000000000206',
        name: 'Mezzanine',
        description: null,
        thumbnail: null,
        assetStatus: AssetStatus.NONE,
        syncStatus: SyncStatus.PENDING,
        modelVersion: 1,
      },
    ],
  },
  {
    id: '00000000-0000-4000-8000-000000000103',
    name: 'Harbor View Studio',
    description: 'Compact studio by the waterfront for the local development demo',
    scans: [
      {
        id: '00000000-0000-4000-8000-000000000207',
        name: 'Main Studio',
        description: null,
        thumbnail: null,
        assetStatus: AssetStatus.UPLOADED,
        syncStatus: SyncStatus.SYNCED,
        modelVersion: 1,
      },
    ],
  },
];

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

function modelAssetId(scanId: string): string {
  return `${scanId.slice(0, 24)}1${scanId.slice(25)}`;
}

export async function seedLocalTestProject(client: SeedClient): Promise<{ invitationUrl: string }> {
  let invitationUrl = '';
  await client.$transaction(async (transaction) => {
    for (const project of LOCAL_TEST_PROJECTS) {
      await transaction.project.upsert({
        where: { id: project.id },
        create: {
          id: project.id,
          name: project.name,
          description: project.description,
          ownerId: LOCAL_TEST_USER_ID,
        },
        update: {
          name: project.name,
          description: project.description,
          deletedAt: null,
        },
      });

      for (const scan of project.scans) {
        await transaction.scan.upsert({
          where: { id: scan.id },
          create: {
            id: scan.id,
            projectId: project.id,
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
        if (scan.assetStatus !== AssetStatus.NONE) {
          await transaction.scanAsset.upsert({
            where: { id: modelAssetId(scan.id) },
            create: {
              id: modelAssetId(scan.id),
              scanId: scan.id,
              assetType: 'MODEL',
              status: scan.assetStatus,
              contentType: 'model/usdz',
              sizeBytes: 10_000_000,
              checksum: `seed-${scan.id}`,
              modelVersion: scan.modelVersion.toString(),
              storageKey: `scans/${scan.id}/model`,
              uploadedAt: scan.assetStatus === AssetStatus.UPLOADED ? new Date() : null,
            },
            update: {
              status: scan.assetStatus,
              checksum: `seed-${scan.id}`,
              modelVersion: scan.modelVersion.toString(),
              uploadedAt: scan.assetStatus === AssetStatus.UPLOADED ? new Date() : null,
              deletedAt: null,
            },
          });
        }
      }

      const projectStatus = project.scans.some((scan) => scan.assetStatus === AssetStatus.FAILED)
        ? SyncStatus.FAILED
        : project.scans.some((scan) => scan.assetStatus === AssetStatus.UPLOADING)
          ? SyncStatus.SYNCING
          : project.scans.some(
                (scan) =>
                  scan.assetStatus === AssetStatus.NONE || scan.assetStatus === AssetStatus.PENDING,
              )
            ? SyncStatus.PENDING
            : SyncStatus.SYNCED;
      await transaction.project.update({
        where: { id: project.id },
        data: {
          syncStatus: projectStatus,
          ...(projectStatus === SyncStatus.SYNCED ? { lastSyncedAt: new Date() } : {}),
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

    for (const shared of LOCAL_TEST_SHARED_PROJECTS) {
      await transaction.project.upsert({
        where: { id: shared.id },
        create: {
          id: shared.id,
          name: shared.name,
          description: shared.description,
          ownerId: LOCAL_TEST_VIEWER_ID,
          deletedAt: shared.projectDeletedAt,
        },
        update: {
          name: shared.name,
          description: shared.description,
          deletedAt: shared.projectDeletedAt,
        },
      });

      await transaction.scan.upsert({
        where: { id: shared.scan.id },
        create: {
          id: shared.scan.id,
          projectId: shared.id,
          createdById: LOCAL_TEST_VIEWER_ID,
          name: shared.scan.name,
          description: null,
          thumbnail: null,
          assetStatus: AssetStatus.UPLOADED,
          syncStatus: SyncStatus.SYNCED,
          modelVersion: 1,
        },
        update: {
          name: shared.scan.name,
          description: null,
          thumbnail: null,
          assetStatus: AssetStatus.UPLOADED,
          syncStatus: SyncStatus.SYNCED,
          modelVersion: 1,
          deletedAt: null,
        },
      });

      await transaction.scanAsset.upsert({
        where: { id: modelAssetId(shared.scan.id) },
        create: {
          id: modelAssetId(shared.scan.id),
          scanId: shared.scan.id,
          assetType: 'MODEL',
          status: 'UPLOADED',
          contentType: 'model/usdz',
          sizeBytes: 10_000_000,
          checksum: `seed-${shared.scan.id}`,
          modelVersion: '1',
          storageKey: `scans/${shared.scan.id}/model`,
          uploadedAt: new Date(),
        },
        update: { status: 'UPLOADED', uploadedAt: new Date(), deletedAt: null },
      });
      await transaction.project.update({
        where: { id: shared.id },
        data: { syncStatus: 'SYNCED', lastSyncedAt: new Date() },
      });

      const access = await transaction.projectAccess.upsert({
        where: {
          projectId_userId: {
            projectId: shared.id,
            userId: LOCAL_TEST_USER_ID,
          },
        },
        create: {
          projectId: shared.id,
          userId: LOCAL_TEST_USER_ID,
          role: 'VIEWER',
          acceptedAt: new Date(),
          revokedAt: shared.accessRevokedAt,
        },
        update: {
          role: 'VIEWER',
          acceptedAt: new Date(),
          revokedAt: shared.accessRevokedAt,
        },
      });
      if (shared.projectDeletedAt === null && shared.accessRevokedAt === null) {
        await resetProjectSyncState(transaction, [shared.id]);
        await writeAccessUpsert(transaction, access.id);
        await writeAccessUpsert(transaction, access.id, { targetUserId: LOCAL_TEST_USER_ID });
        await writeProjectBootstrap(transaction, shared.id, LOCAL_TEST_USER_ID, new Date());
        await writeProjectBootstrap(transaction, shared.id, LOCAL_TEST_VIEWER_ID, new Date());
      }
    }

    const ownerProjectViewerAccess = await transaction.projectAccess.upsert({
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
        revokedAt: null,
      },
      update: {
        role: 'VIEWER',
        acceptedAt: new Date(),
        revokedAt: null,
      },
    });
    await resetProjectSyncState(
      transaction,
      LOCAL_TEST_PROJECTS.map((project) => project.id),
    );
    await writeAccessUpsert(transaction, ownerProjectViewerAccess.id);
    await writeAccessUpsert(transaction, ownerProjectViewerAccess.id, {
      targetUserId: LOCAL_TEST_VIEWER_ID,
    });
    for (const project of LOCAL_TEST_PROJECTS) {
      await writeProjectBootstrap(transaction, project.id, LOCAL_TEST_USER_ID, new Date());
    }
    await writeProjectBootstrap(
      transaction,
      LOCAL_TEST_PROJECT_ID,
      LOCAL_TEST_VIEWER_ID,
      new Date(),
    );

    const rawToken = generateInvitationToken();
    await transaction.invitation.upsert({
      where: { id: LOCAL_TEST_INVITATION_ID },
      create: {
        id: LOCAL_TEST_INVITATION_ID,
        projectId: LOCAL_TEST_PROJECT_ID,
        createdById: LOCAL_TEST_USER_ID,
        recipientEmail: LOCAL_TEST_PENDING_INVITE_EMAIL,
        tokenHash: hashInvitationToken(rawToken),
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        sentAt: new Date(),
      },
      update: {
        projectId: LOCAL_TEST_PROJECT_ID,
        createdById: LOCAL_TEST_USER_ID,
        recipientEmail: LOCAL_TEST_PENDING_INVITE_EMAIL,
        tokenHash: hashInvitationToken(rawToken),
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        sentAt: new Date(),
        acceptedAt: null,
        acceptedByUserId: null,
        declinedAt: null,
        revokedAt: null,
      },
    });

    invitationUrl = `http://localhost:3000/invitations/${rawToken}`;
  });

  return { invitationUrl };
}
