import { describe, expect, it, vi } from 'vitest';

import { Prisma, type PrismaClient } from '../src/generated/prisma/client.js';
import { LOCAL_TEST_USER_ID, LOCAL_TEST_VIEWER_ID } from '../src/config/constants.js';
import {
  LOCAL_TEST_INVITATION_ID,
  LOCAL_TEST_NOTES,
  LOCAL_TEST_PROJECT_ID,
  LOCAL_TEST_PROJECT_NAME,
  LOCAL_TEST_SCANS,
  seedLocalTestProject,
} from '../src/infrastructure/database/local-test-project-seed.js';

describe('seedLocalTestProject', () => {
  it('idempotently created or refreshes a demo project owned by the local user', async () => {
    const projectUpsert = vi.fn().mockResolvedValue({});
    const scanUpsert = vi.fn().mockResolvedValue({});
    const noteUpsert = vi.fn().mockResolvedValue({});
    const projectAccessUpsert = vi.fn().mockResolvedValue({});
    const invitationUpsert = vi.fn().mockResolvedValue({});
    const transaction = vi.fn(async (operation: unknown) => {
      return (
        operation as (tx: {
          project: { upsert: typeof projectUpsert };
          scan: { upsert: typeof scanUpsert };
          note: { upsert: typeof noteUpsert };
          projectAccess: { upsert: typeof projectAccessUpsert };
          invitation: { upsert: typeof invitationUpsert };
        }) => Promise<unknown>
      )({
        project: { upsert: projectUpsert },
        scan: { upsert: scanUpsert },
        note: { upsert: noteUpsert },
        projectAccess: { upsert: projectAccessUpsert },
        invitation: { upsert: invitationUpsert },
      });
    });
    const client = {
      $transaction: transaction,
    } as unknown as Pick<PrismaClient, '$transaction'>;

    const { invitationUrl } = await seedLocalTestProject(client);
    expect(invitationUrl).toContain('http://localhost:3000/invitations/');

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

    expect(noteUpsert).toHaveBeenCalledTimes(LOCAL_TEST_NOTES.length);
    for (const note of LOCAL_TEST_NOTES) {
      expect(noteUpsert).toHaveBeenCalledWith({
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
    const accessCreate = (
      projectAccessUpsert.mock.calls[0]?.[0] as {
        create: {
          projectId: string;
          userId: string;
          role: string;
          acceptedAt: Date;
          declinedAt: null;
          revokedAt: null;
        };
      }
    ).create;
    expect(accessCreate).toMatchObject({
      projectId: LOCAL_TEST_PROJECT_ID,
      userId: LOCAL_TEST_VIEWER_ID,
      role: 'VIEWER',
      revokedAt: null,
    });
    expect(accessCreate.acceptedAt).toBeInstanceOf(Date);

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
