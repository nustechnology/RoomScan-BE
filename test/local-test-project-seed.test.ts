import { describe, expect, it, vi } from 'vitest';

import { Prisma, type PrismaClient } from '../src/generated/prisma/client.js';
import { LOCAL_TEST_USER_ID, LOCAL_TEST_VIEWER_ID } from '../src/config/constants.js';
import {
  LOCAL_TEST_INVITATION_ID,
  LOCAL_TEST_NOTES,
  LOCAL_TEST_PROJECT_ID,
  LOCAL_TEST_PROJECTS,
  LOCAL_TEST_SCAN_ACCESSES,
  LOCAL_TEST_SHARED_PROJECTS,
  seedLocalTestProject,
} from '../src/infrastructure/database/local-test-project-seed.js';

describe('seedLocalTestProject', () => {
  it('idempotently creates demo projects covering every Shared With Me status', async () => {
    const projectUpsert = vi.fn().mockResolvedValue({});
    const scanUpsert = vi.fn().mockResolvedValue({});
    const noteUpsert = vi.fn().mockResolvedValue({});
    const projectAccessUpsert = vi.fn().mockResolvedValue({});
    const scanAccessUpsert = vi.fn().mockResolvedValue({});
    const invitationUpsert = vi.fn().mockResolvedValue({});
    const transaction = vi.fn(async (operation: unknown) => {
      return (
        operation as (tx: {
          project: { upsert: typeof projectUpsert };
          scan: { upsert: typeof scanUpsert };
          note: { upsert: typeof noteUpsert };
          projectAccess: { upsert: typeof projectAccessUpsert };
          scanAccess: { upsert: typeof scanAccessUpsert };
          invitation: { upsert: typeof invitationUpsert };
        }) => Promise<unknown>
      )({
        project: { upsert: projectUpsert },
        scan: { upsert: scanUpsert },
        note: { upsert: noteUpsert },
        projectAccess: { upsert: projectAccessUpsert },
        scanAccess: { upsert: scanAccessUpsert },
        invitation: { upsert: invitationUpsert },
      });
    });
    const client = {
      $transaction: transaction,
    } as unknown as Pick<PrismaClient, '$transaction'>;

    const { invitationUrl } = await seedLocalTestProject(client);
    expect(invitationUrl).toContain('http://localhost:3000/invitations/');

    expect(projectUpsert).toHaveBeenCalledTimes(
      LOCAL_TEST_PROJECTS.length + LOCAL_TEST_SHARED_PROJECTS.length,
    );
    for (const project of LOCAL_TEST_PROJECTS) {
      expect(projectUpsert).toHaveBeenCalledWith({
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
    }
    for (const shared of LOCAL_TEST_SHARED_PROJECTS) {
      expect(projectUpsert).toHaveBeenCalledWith({
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
    }

    const totalScans = LOCAL_TEST_PROJECTS.reduce(
      (count, project) => count + project.scans.length,
      0,
    );
    expect(scanUpsert).toHaveBeenCalledTimes(totalScans + LOCAL_TEST_SHARED_PROJECTS.length);
    for (const project of LOCAL_TEST_PROJECTS) {
      for (const scan of project.scans) {
        expect(scanUpsert).toHaveBeenCalledWith({
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
      }
    }
    for (const shared of LOCAL_TEST_SHARED_PROJECTS) {
      expect(scanUpsert).toHaveBeenCalledWith({
        where: { id: shared.scan.id },
        create: {
          id: shared.scan.id,
          projectId: shared.id,
          createdById: LOCAL_TEST_VIEWER_ID,
          name: shared.scan.name,
          description: null,
          thumbnail: null,
          assetStatus: 'UPLOADED',
          syncStatus: 'SYNCED',
          modelVersion: 1,
        },
        update: {
          name: shared.scan.name,
          description: null,
          thumbnail: null,
          assetStatus: 'UPLOADED',
          syncStatus: 'SYNCED',
          modelVersion: 1,
          deletedAt: null,
        },
      });
    }

    expect(noteUpsert).toHaveBeenCalledTimes(LOCAL_TEST_NOTES.length);
    for (const note of LOCAL_TEST_NOTES) {
      expect(noteUpsert).toHaveBeenCalledWith({
        where: { id: note.id },
        create: {
          id: note.id,
          scanId: note.scanId,
          createdById: LOCAL_TEST_USER_ID,
          title: note.title,
          content: note.content,
          color: note.color,
          position: note.position,
          orientation: note.orientation === null ? Prisma.JsonNull : note.orientation,
          modelVersion: note.modelVersion,
        },
        update: {
          scanId: note.scanId,
          title: note.title,
          content: note.content,
          color: note.color,
          position: note.position,
          orientation: note.orientation === null ? Prisma.JsonNull : note.orientation,
          modelVersion: note.modelVersion,
        },
      });
    }

    for (const shared of LOCAL_TEST_SHARED_PROJECTS) {
      expect(projectAccessUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            projectId_userId: {
              projectId: shared.id,
              userId: LOCAL_TEST_USER_ID,
            },
          },
        }),
      );
    }
    expect(projectAccessUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId_userId: {
            projectId: LOCAL_TEST_PROJECT_ID,
            userId: LOCAL_TEST_VIEWER_ID,
          },
        },
      }),
    );
    expect(projectAccessUpsert).toHaveBeenCalledTimes(LOCAL_TEST_SHARED_PROJECTS.length + 1);
    const accessCalls = projectAccessUpsert.mock.calls as unknown as Array<
      [
        {
          create: {
            projectId: string;
            userId: string;
            role: string;
            acceptedAt: Date;
            revokedAt: Date | null;
          };
          update: {
            role: string;
            revokedAt: Date | null;
          };
        },
      ]
    >;
    LOCAL_TEST_SHARED_PROJECTS.forEach((shared, index) => {
      const accessCreate = accessCalls[index]?.[0]?.create;
      expect(accessCreate).toBeDefined();
      expect(accessCreate).toMatchObject({
        projectId: shared.id,
        userId: LOCAL_TEST_USER_ID,
        role: 'VIEWER',
        revokedAt: shared.accessRevokedAt,
      });
      expect(accessCreate?.acceptedAt).toBeInstanceOf(Date);
      expect(accessCalls[index]?.[0]?.update).toMatchObject({
        role: 'VIEWER',
        revokedAt: shared.accessRevokedAt,
      });
    });
    const viewerAccessCreate = accessCalls[LOCAL_TEST_SHARED_PROJECTS.length]?.[0]?.create;
    expect(viewerAccessCreate).toBeDefined();
    expect(viewerAccessCreate).toMatchObject({
      projectId: LOCAL_TEST_PROJECT_ID,
      userId: LOCAL_TEST_VIEWER_ID,
      role: 'VIEWER',
      revokedAt: null,
    });
    expect(viewerAccessCreate?.acceptedAt).toBeInstanceOf(Date);

    expect(scanAccessUpsert).toHaveBeenCalledTimes(LOCAL_TEST_SCAN_ACCESSES.length);
    const scanAccessCalls = scanAccessUpsert.mock.calls as unknown as Array<
      [
        {
          where: { scanId_userId: { scanId: string; userId: string } };
          create: {
            scanId: string;
            userId: string;
            role: string;
            acceptedAt: Date;
            revokedAt: Date | null;
          };
        },
      ]
    >;
    LOCAL_TEST_SCAN_ACCESSES.forEach((scanAccess, index) => {
      const accessCreate = scanAccessCalls[index]?.[0]?.create;
      expect(accessCreate).toBeDefined();
      expect(accessCreate).toMatchObject({
        scanId: scanAccess.scanId,
        userId: LOCAL_TEST_USER_ID,
        role: 'VIEWER',
        revokedAt: scanAccess.accessRevokedAt,
      });
      expect(accessCreate?.acceptedAt).toBeInstanceOf(Date);
      expect(scanAccessCalls[index]?.[0]?.where.scanId_userId).toMatchObject({
        scanId: scanAccess.scanId,
        userId: LOCAL_TEST_USER_ID,
      });
    });

    expect(invitationUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: LOCAL_TEST_INVITATION_ID },
      }),
    );
    const invitationCreate = (
      invitationUpsert.mock.calls[0]?.[0] as {
        create: {
          id: string;
          projectId: string;
          createdById: string;
          tokenHash: string;
          status: string;
          expiresAt: Date;
          sentAt: Date;
        };
      }
    ).create;
    expect(invitationCreate).toMatchObject({
      id: LOCAL_TEST_INVITATION_ID,
      projectId: LOCAL_TEST_PROJECT_ID,
      createdById: LOCAL_TEST_USER_ID,
      recipientEmail: 'pending-invite@roomscan.dev',
      status: 'PENDING',
    });
    expect(invitationCreate.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(invitationCreate.expiresAt).toBeInstanceOf(Date);
    expect(invitationCreate.sentAt).toBeInstanceOf(Date);

    expect(transaction).toHaveBeenCalledOnce();
  });
});
