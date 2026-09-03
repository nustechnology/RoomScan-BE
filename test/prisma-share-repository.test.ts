import { describe, expect, it, vi } from 'vitest';

import { Prisma, type PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaShareRepository } from '../src/infrastructure/database/prisma-share-repository.js';
import type { PrismaIdempotencyExecutor } from '../src/infrastructure/database/prisma-idempotency.js';
import { InvitationAlreadySentError } from '../src/modules/share/share.errors.js';

const PROJECT_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const SCAN_ID = 'f1e2d3c4-a5b6-7890-abcd-ef1234567890';
const OWNER_ID = 'eb5d278f-c857-45c7-887d-7be65288cb75';
const VIEWER_ID = '8c53d31d-2788-48de-82a0-c4f219ca3701';
const INVITATION_ID = 'b1a2c3d4-e5f6-4890-abcd-ef1234567890';
const SHARE_LINK_ID = 'c0ffee00-0000-4000-8000-0000000000aa';
const TOKEN_HASH = 'a'.repeat(64);
const RECIPIENT_EMAIL = 'recipient@example.com';
const NOW = new Date('2026-07-29T10:00:00.000Z');

function createInvitationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: INVITATION_ID,
    projectId: PROJECT_ID,
    scanId: null,
    createdById: OWNER_ID,
    recipientEmail: RECIPIENT_EMAIL,
    tokenHash: TOKEN_HASH,
    status: 'PENDING',
    expiresAt: NOW,
    sentAt: NOW,
    acceptedAt: null,
    acceptedByUserId: null,
    declinedAt: null,
    revokedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function createClient() {
  const invitation = {
    create: vi.fn().mockResolvedValue(createInvitationRow()),
    findFirst: vi.fn().mockResolvedValue(createInvitationRow()),
    findUnique: vi.fn().mockResolvedValue(createInvitationRow()),
    findMany: vi.fn().mockResolvedValue([createInvitationRow()]),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const projectAccess = {
    findFirst: vi.fn().mockResolvedValue({ id: 'access-id' }),
    findUnique: vi.fn().mockResolvedValue({ id: 'access-id', revision: 1, revokedAt: null }),
    findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'access-id' }),
    upsert: vi.fn().mockResolvedValue({ id: 'access-id' }),
    update: vi.fn().mockResolvedValue({ revokedAt: NOW, revision: 2 }),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    create: vi.fn().mockResolvedValue({ id: 'access-id' }),
    findMany: vi.fn().mockResolvedValue([
      {
        userId: VIEWER_ID,
        revision: 1,
        acceptedAt: NOW,
        createdAt: NOW,
        user: { id: VIEWER_ID, email: RECIPIENT_EMAIL },
      },
    ]),
  };
  const scanAccess = {
    findFirst: vi.fn().mockResolvedValue({ id: 'scan-access-id' }),
    findUnique: vi.fn().mockResolvedValue({ id: 'scan-access-id', revokedAt: null }),
    findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'scan-access-id' }),
    upsert: vi.fn().mockResolvedValue({ id: 'scan-access-id' }),
    update: vi.fn().mockResolvedValue({ revokedAt: NOW }),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    create: vi.fn().mockResolvedValue({ id: 'scan-access-id' }),
    findMany: vi.fn().mockResolvedValue([
      {
        userId: VIEWER_ID,
        acceptedAt: NOW,
        createdAt: NOW,
        user: { id: VIEWER_ID, email: RECIPIENT_EMAIL },
      },
    ]),
  };
  const shareLink = {
    create: vi.fn().mockResolvedValue({
      id: SHARE_LINK_ID,
      projectId: PROJECT_ID,
      scanId: null,
      createdById: OWNER_ID,
      tokenHash: TOKEN_HASH,
      expiresAt: NOW,
      revokedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    }),
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue({
      id: SHARE_LINK_ID,
      projectId: PROJECT_ID,
      scanId: null,
      createdById: OWNER_ID,
      tokenHash: TOKEN_HASH,
      expiresAt: NOW,
      revokedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    }),
    findMany: vi.fn().mockResolvedValue([]),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const project = {
    findFirst: vi.fn().mockResolvedValue({ ownerId: OWNER_ID }),
  };
  const scan = {
    findFirst: vi.fn().mockResolvedValue({ id: 'scan-id' }),
  };
  const transaction = vi.fn(async (operation: unknown) => {
    return (
      operation as (tx: {
        invitation: {
          updateMany: typeof invitation.updateMany;
          create: typeof invitation.create;
          findUnique: typeof invitation.findUnique;
        };
        projectAccess: {
          upsert: typeof projectAccess.upsert;
          findFirst: typeof projectAccess.findFirst;
          updateMany: typeof projectAccess.updateMany;
          create: typeof projectAccess.create;
          findUniqueOrThrow: typeof projectAccess.findUniqueOrThrow;
        };
        scanAccess: { upsert: typeof scanAccess.upsert };
      }) => Promise<unknown>
    )({
      invitation: {
        updateMany: invitation.updateMany,
        create: invitation.create,
        findUnique: invitation.findUnique,
      },
      projectAccess: {
        upsert: projectAccess.upsert,
        findFirst: projectAccess.findFirst,
        updateMany: projectAccess.updateMany,
        create: projectAccess.create,
        findUniqueOrThrow: projectAccess.findUniqueOrThrow,
      },
      scanAccess: { upsert: scanAccess.upsert },
    });
  });
  const client = {
    invitation,
    projectAccess,
    scanAccess,
    shareLink,
    project,
    scan,
    $transaction: transaction,
  } as unknown as Pick<
    PrismaClient,
    | 'invitation'
    | 'projectAccess'
    | 'scanAccess'
    | 'shareLink'
    | 'project'
    | 'scan'
    | '$transaction'
  >;

  return { client, invitation, projectAccess, scanAccess, shareLink, project, scan, transaction };
}

describe('PrismaShareRepository', () => {
  it('findProjectOwner returns the active project owner', async () => {
    const { client, project } = createClient();

    await expect(new PrismaShareRepository(client).findProjectOwner(PROJECT_ID)).resolves.toBe(
      OWNER_ID,
    );
    expect(project.findFirst).toHaveBeenCalledWith({
      where: { id: PROJECT_ID, deletedAt: null },
      select: { ownerId: true },
    });
  });

  it('findProjectOwner returns null when the project is missing or deleted', async () => {
    const { client, project } = createClient();
    project.findFirst.mockResolvedValue(null);

    await expect(
      new PrismaShareRepository(client).findProjectOwner(PROJECT_ID),
    ).resolves.toBeNull();
  });

  it('findProjectInfo returns the name and owner for email delivery', async () => {
    const { client, project } = createClient();
    project.findFirst.mockResolvedValue({
      name: 'District 2 Apartment',
      ownerId: OWNER_ID,
      owner: { email: 'owner@example.com' },
    });

    const result = await new PrismaShareRepository(client).findProjectInfo(PROJECT_ID);

    expect(result).toEqual({
      name: 'District 2 Apartment',
      ownerId: OWNER_ID,
      ownerEmail: 'owner@example.com',
    });
  });

  it('findProjectInfo returns null when the project is missing or deleted', async () => {
    const { client, project } = createClient();
    project.findFirst.mockResolvedValue(null);

    await expect(new PrismaShareRepository(client).findProjectInfo(PROJECT_ID)).resolves.toBeNull();
  });

  it('hasUploadedModel is true when a non-deleted scan has an uploaded model', async () => {
    const { client, scan } = createClient();

    await expect(new PrismaShareRepository(client).hasUploadedModel(PROJECT_ID)).resolves.toBe(
      true,
    );
    expect(scan.findFirst).toHaveBeenCalledWith({
      where: { projectId: PROJECT_ID, deletedAt: null, assetStatus: 'UPLOADED' },
      select: { id: true },
    });
  });

  it('hasUploadedModel is false when no uploaded model exists', async () => {
    const { client, scan } = createClient();
    scan.findFirst.mockResolvedValue(null);

    await expect(new PrismaShareRepository(client).hasUploadedModel(PROJECT_ID)).resolves.toBe(
      false,
    );
  });

  it('createInvitation revokes expired pending invitations and stores the recipient', async () => {
    const { client, invitation } = createClient();

    await new PrismaShareRepository(client).createInvitation({
      projectId: PROJECT_ID,
      createdById: OWNER_ID,
      recipientEmail: RECIPIENT_EMAIL,
      tokenHash: TOKEN_HASH,
      expiresAt: NOW,
      sentAt: NOW,
    });

    expect(invitation.updateMany).toHaveBeenCalledWith({
      where: {
        projectId: PROJECT_ID,
        scanId: null,
        recipientEmail: RECIPIENT_EMAIL,
        status: 'PENDING',
        expiresAt: { lte: NOW },
      },
      data: { status: 'REVOKED', revokedAt: NOW },
    });
    expect(invitation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          projectId: PROJECT_ID,
          scanId: null,
          createdById: OWNER_ID,
          recipientEmail: RECIPIENT_EMAIL,
          tokenHash: TOKEN_HASH,
          status: 'PENDING',
          expiresAt: NOW,
          sentAt: NOW,
        },
      }),
    );
  });

  it('createInvitation maps a concurrent duplicate to InvitationAlreadySentError', async () => {
    const { client, invitation } = createClient();
    const conflict = new Prisma.PrismaClientKnownRequestError('unique constraint', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['projectId', 'recipientEmail'] },
    });
    invitation.create.mockRejectedValueOnce(conflict);

    await expect(
      new PrismaShareRepository(client).createInvitation({
        projectId: PROJECT_ID,
        createdById: OWNER_ID,
        recipientEmail: RECIPIENT_EMAIL,
        tokenHash: TOKEN_HASH,
        expiresAt: NOW,
        sentAt: NOW,
      }),
    ).rejects.toBeInstanceOf(InvitationAlreadySentError);
  });

  it('createInvitation rethrows non-duplicate errors', async () => {
    const { client, invitation } = createClient();
    invitation.create.mockRejectedValueOnce(new Error('boom'));

    await expect(
      new PrismaShareRepository(client).createInvitation({
        projectId: PROJECT_ID,
        createdById: OWNER_ID,
        recipientEmail: RECIPIENT_EMAIL,
        tokenHash: TOKEN_HASH,
        expiresAt: NOW,
        sentAt: NOW,
      }),
    ).rejects.toThrow('boom');
  });

  it('findByTokenHash returns the invitation with its project summary', async () => {
    const { client, invitation } = createClient();
    invitation.findFirst.mockResolvedValue({
      ...createInvitationRow(),
      project: {
        id: PROJECT_ID,
        name: 'District 2 Apartment',
        description: null,
        owner: { id: OWNER_ID, email: 'owner@example.com' },
        scans: [
          {
            thumbnail: 'http://storage.local/thumb/scan1.jpg',
          },
        ],
        _count: { scans: 2 },
      },
      scan: null,
    });

    const result = await new PrismaShareRepository(client).findByTokenHash(TOKEN_HASH);

    expect(result?.invitation.recipientEmail).toBe(RECIPIENT_EMAIL);
    expect(result?.invitation.tokenHash).toBe(TOKEN_HASH);
    expect(result?.project).toEqual({
      id: PROJECT_ID,
      name: 'District 2 Apartment',
      description: null,
      thumbnail: 'http://storage.local/thumb/scan1.jpg',
      owner: { id: OWNER_ID, email: 'owner@example.com' },
      scanCount: 2,
    });
    expect(result?.scan).toBeNull();
    expect(invitation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tokenHash: TOKEN_HASH,
          OR: [
            { projectId: { not: null }, project: { deletedAt: null } },
            { scanId: { not: null }, scan: { deletedAt: null, project: { deletedAt: null } } },
          ],
        },
      }),
    );
  });

  it('findByTokenHash returns null for an unknown token', async () => {
    const { client, invitation } = createClient();
    invitation.findFirst.mockResolvedValue(null);

    await expect(new PrismaShareRepository(client).findByTokenHash(TOKEN_HASH)).resolves.toBeNull();
  });

  it('findTokenSourceKindByTokenHash reports an invitation whose source is deleted', async () => {
    const { client, invitation } = createClient();
    invitation.findFirst.mockResolvedValue({ id: INVITATION_ID });

    const result = await new PrismaShareRepository(client).findTokenSourceKindByTokenHash(
      TOKEN_HASH,
    );

    expect(result).toBe('invitation');
    expect(invitation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tokenHash: TOKEN_HASH,
          OR: [
            { projectId: { not: null }, project: { deletedAt: { not: null } } },
            {
              scanId: { not: null },
              scan: {
                OR: [{ deletedAt: { not: null } }, { project: { deletedAt: { not: null } } }],
              },
            },
          ],
        },
      }),
    );
  });

  it('findTokenSourceKindByTokenHash reports a share link whose source is deleted', async () => {
    const { client, invitation, shareLink } = createClient();
    invitation.findFirst.mockResolvedValue(null);
    shareLink.findFirst.mockResolvedValue({ id: SHARE_LINK_ID });

    const result = await new PrismaShareRepository(client).findTokenSourceKindByTokenHash(
      TOKEN_HASH,
    );

    expect(result).toBe('share-link');
    expect(shareLink.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tokenHash: TOKEN_HASH,
          OR: [
            { projectId: { not: null }, project: { deletedAt: { not: null } } },
            {
              scanId: { not: null },
              scan: {
                OR: [{ deletedAt: { not: null } }, { project: { deletedAt: { not: null } } }],
              },
            },
          ],
        },
      }),
    );
  });

  it('findTokenSourceKindByTokenHash returns null when no token exists', async () => {
    const { client, invitation } = createClient();
    invitation.findFirst.mockResolvedValue(null);

    const result = await new PrismaShareRepository(client).findTokenSourceKindByTokenHash(
      TOKEN_HASH,
    );

    expect(result).toBeNull();
  });

  it('findInvitationById returns the stored invitation', async () => {
    const { client, invitation } = createClient();

    const result = await new PrismaShareRepository(client).findInvitationById(INVITATION_ID);

    expect(result).toEqual(expect.objectContaining({ id: INVITATION_ID, status: 'PENDING' }));
    expect(invitation.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: INVITATION_ID },
      }),
    );
  });

  it('acceptInvitation marks the invitation ACCEPTED and grants Viewer access in one transaction', async () => {
    const { client, invitation, projectAccess, transaction } = createClient();
    invitation.findUnique.mockResolvedValue(
      createInvitationRow({ status: 'ACCEPTED', acceptedAt: NOW, acceptedByUserId: VIEWER_ID }),
    );

    const result = await new PrismaShareRepository(client).acceptInvitation(
      INVITATION_ID,
      PROJECT_ID,
      VIEWER_ID,
      NOW,
    );

    expect(result?.status).toBe('ACCEPTED');
    expect(transaction).toHaveBeenCalledOnce();
    expect(invitation.updateMany).toHaveBeenCalledWith({
      where: {
        id: INVITATION_ID,
        projectId: PROJECT_ID,
        status: 'PENDING',
        expiresAt: { gt: NOW },
      },
      data: { status: 'ACCEPTED', acceptedAt: NOW, acceptedByUserId: VIEWER_ID },
    });
    expect(projectAccess.upsert).toHaveBeenCalledWith({
      where: { projectId_userId: { projectId: PROJECT_ID, userId: VIEWER_ID } },
      create: {
        projectId: PROJECT_ID,
        userId: VIEWER_ID,
        role: 'VIEWER',
        invitationId: INVITATION_ID,
        acceptedAt: NOW,
        revokedAt: null,
        deletedAt: null,
      },
      update: {
        role: 'VIEWER',
        invitationId: INVITATION_ID,
        acceptedAt: NOW,
        revokedAt: null,
        deletedAt: null,
        revision: { increment: 1 },
        updatedAt: NOW,
      },
      select: { id: true },
    });
  });

  it('acceptInvitation returns null when the invitation is no longer pending', async () => {
    const { client, invitation } = createClient();
    invitation.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      new PrismaShareRepository(client).acceptInvitation(INVITATION_ID, PROJECT_ID, VIEWER_ID, NOW),
    ).resolves.toBeNull();
  });

  it('acceptInvitation returns null when the invitation belongs to a different project', async () => {
    const { client, invitation, projectAccess } = createClient();
    const otherProjectId = 'c1d2e3f4-5a6b-4780-9abc-def012345678';
    invitation.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      new PrismaShareRepository(client).acceptInvitation(
        INVITATION_ID,
        otherProjectId,
        VIEWER_ID,
        NOW,
      ),
    ).resolves.toBeNull();
    expect(invitation.updateMany).toHaveBeenCalledWith({
      where: {
        id: INVITATION_ID,
        projectId: otherProjectId,
        status: 'PENDING',
        expiresAt: { gt: NOW },
      },
      data: { status: 'ACCEPTED', acceptedAt: NOW, acceptedByUserId: VIEWER_ID },
    });
    expect(projectAccess.upsert).not.toHaveBeenCalled();
  });

  it('declineInvitation marks the invitation DECLINED', async () => {
    const { client, invitation } = createClient();
    invitation.findUnique.mockResolvedValue(
      createInvitationRow({ status: 'DECLINED', declinedAt: NOW }),
    );

    const result = await new PrismaShareRepository(client).declineInvitation(INVITATION_ID, NOW);

    expect(result?.status).toBe('DECLINED');
    expect(invitation.updateMany).toHaveBeenCalledWith({
      where: { id: INVITATION_ID, status: 'PENDING' },
      data: { status: 'DECLINED', declinedAt: NOW },
    });
  });

  it('declineInvitation returns null when the invitation is no longer pending', async () => {
    const { client, invitation } = createClient();
    invitation.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      new PrismaShareRepository(client).declineInvitation(INVITATION_ID, NOW),
    ).resolves.toBeNull();
  });

  it('revokeInvitation marks a pending invitation REVOKED', async () => {
    const { client, invitation } = createClient();
    invitation.findUnique.mockResolvedValue(
      createInvitationRow({ status: 'REVOKED', revokedAt: NOW }),
    );

    const result = await new PrismaShareRepository(client).revokeInvitation(INVITATION_ID, NOW);

    expect(result?.status).toBe('REVOKED');
    expect(invitation.updateMany).toHaveBeenCalledWith({
      where: { id: INVITATION_ID, status: 'PENDING' },
      data: { status: 'REVOKED', revokedAt: NOW },
    });
  });

  it('revokeInvitation returns null for a non-pending invitation', async () => {
    const { client, invitation } = createClient();
    invitation.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      new PrismaShareRepository(client).revokeInvitation(INVITATION_ID, NOW),
    ).resolves.toBeNull();
  });

  it('resendInvitation rotates the token and refreshes sentAt and expiresAt', async () => {
    const { client, invitation } = createClient();
    const newHash = 'b'.repeat(64);
    const expiresAt = new Date(NOW.getTime() + 60_000);
    invitation.findUnique.mockResolvedValue(
      createInvitationRow({ tokenHash: newHash, sentAt: NOW, expiresAt }),
    );

    const result = await new PrismaShareRepository(client).resendInvitation(INVITATION_ID, {
      tokenHash: newHash,
      sentAt: NOW,
      expiresAt,
    });

    expect(result?.tokenHash).toBe(newHash);
    expect(invitation.updateMany).toHaveBeenCalledWith({
      where: { id: INVITATION_ID, status: 'PENDING' },
      data: { tokenHash: newHash, sentAt: NOW, expiresAt },
    });
  });

  it('listPendingByProject returns only PENDING invitations', async () => {
    const { client, invitation } = createClient();

    const result = await new PrismaShareRepository(client).listPendingByProject(PROJECT_ID);

    expect(result).toHaveLength(1);
    expect(invitation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: PROJECT_ID, status: 'PENDING' },
        orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
      }),
    );
  });

  it('findActiveViewerAccess returns the active access id', async () => {
    const { client, projectAccess } = createClient();

    await expect(
      new PrismaShareRepository(client).findActiveViewerAccess(PROJECT_ID, VIEWER_ID),
    ).resolves.toEqual({ id: 'access-id' });
    expect(projectAccess.findFirst).toHaveBeenCalledWith({
      where: { projectId: PROJECT_ID, userId: VIEWER_ID, revokedAt: null, deletedAt: null },
      select: { id: true },
    });
  });

  it('listActiveViewers maps the acceptedAt (or createdAt) as grantedAt', async () => {
    const { client, projectAccess } = createClient();
    projectAccess.findMany.mockResolvedValue([
      {
        userId: VIEWER_ID,
        revision: 1,
        acceptedAt: NOW,
        createdAt: NOW,
        user: { id: VIEWER_ID, email: RECIPIENT_EMAIL },
      },
      {
        userId: '11111111-2222-4333-8444-555555555555',
        revision: 2,
        acceptedAt: null,
        createdAt: NOW,
        user: { id: '11111111-2222-4333-8444-555555555555', email: null },
      },
    ]);

    const result = await new PrismaShareRepository(client).listActiveViewers(PROJECT_ID);

    expect(result).toEqual([
      {
        userId: VIEWER_ID,
        revision: 1,
        user: { id: VIEWER_ID, email: RECIPIENT_EMAIL },
        grantedAt: NOW,
      },
      {
        userId: '11111111-2222-4333-8444-555555555555',
        revision: 2,
        user: { id: '11111111-2222-4333-8444-555555555555', email: null },
        grantedAt: NOW,
      },
    ]);
    expect(projectAccess.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: PROJECT_ID, role: 'VIEWER', revokedAt: null, deletedAt: null },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    );
  });

  it('revokeViewerAccess returns null when no access record exists', async () => {
    const { client, projectAccess } = createClient();
    projectAccess.findUnique.mockResolvedValue(null);

    await expect(
      new PrismaShareRepository(client).revokeViewerAccess(PROJECT_ID, VIEWER_ID, NOW),
    ).resolves.toBeNull();
  });

  it('revokeViewerAccess returns the existing revokedAt when already revoked', async () => {
    const { client, projectAccess } = createClient();
    projectAccess.findUnique.mockResolvedValue({ id: 'access-id', revision: 2, revokedAt: NOW });

    await expect(
      new PrismaShareRepository(client).revokeViewerAccess(PROJECT_ID, VIEWER_ID, NOW),
    ).resolves.toEqual({ revokedAt: NOW, revision: 2 });
    expect(projectAccess.update).not.toHaveBeenCalled();
  });

  it('revokeViewerAccess revokes an active access idempotently', async () => {
    const { client, projectAccess } = createClient();
    projectAccess.findUnique.mockResolvedValue({ id: 'access-id', revision: 1, revokedAt: null });

    await expect(
      new PrismaShareRepository(client).revokeViewerAccess(PROJECT_ID, VIEWER_ID, NOW),
    ).resolves.toEqual({ revokedAt: NOW, revision: 2 });
    expect(projectAccess.update).toHaveBeenCalledWith({
      where: { id: 'access-id' },
      data: { revokedAt: NOW, revision: { increment: 1 }, updatedAt: NOW },
      select: { revokedAt: true, revision: true },
    });
  });

  it('findScanInfo returns the scan name and project owner', async () => {
    const { client, scan } = createClient();
    scan.findFirst.mockResolvedValue({
      name: 'Living Room',
      projectId: PROJECT_ID,
      project: { ownerId: OWNER_ID, owner: { email: 'owner@example.com' } },
    });

    const result = await new PrismaShareRepository(client).findScanInfo(SCAN_ID);

    expect(result).toEqual({
      name: 'Living Room',
      projectId: PROJECT_ID,
      ownerId: OWNER_ID,
      ownerEmail: 'owner@example.com',
    });
    expect(scan.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: SCAN_ID, deletedAt: null, project: { deletedAt: null } },
      }),
    );
  });

  it('findScanInfo returns null when the scan or project is deleted', async () => {
    const { client, scan } = createClient();
    scan.findFirst.mockResolvedValue(null);

    await expect(new PrismaShareRepository(client).findScanInfo(SCAN_ID)).resolves.toBeNull();
  });

  it('hasUploadedScanModel is true when the scan has an uploaded model', async () => {
    const { client, scan } = createClient();

    await expect(new PrismaShareRepository(client).hasUploadedScanModel(SCAN_ID)).resolves.toBe(
      true,
    );
    expect(scan.findFirst).toHaveBeenCalledWith({
      where: { id: SCAN_ID, deletedAt: null, assetStatus: 'UPLOADED' },
      select: { id: true },
    });
  });

  it('createInvitation stores a scan-scope invitation', async () => {
    const { client, invitation } = createClient();

    await new PrismaShareRepository(client).createInvitation({
      scanId: SCAN_ID,
      createdById: OWNER_ID,
      recipientEmail: RECIPIENT_EMAIL,
      tokenHash: TOKEN_HASH,
      expiresAt: NOW,
      sentAt: NOW,
    });

    expect(invitation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          scanId: SCAN_ID,
          projectId: null,
          recipientEmail: RECIPIENT_EMAIL,
          status: 'PENDING',
          expiresAt: { lte: NOW },
        },
      }),
    );
    expect(invitation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          scanId: SCAN_ID,
          projectId: null,
          createdById: OWNER_ID,
          recipientEmail: RECIPIENT_EMAIL,
          tokenHash: TOKEN_HASH,
          status: 'PENDING',
          expiresAt: NOW,
          sentAt: NOW,
        },
      }),
    );
  });

  it('acceptScanInvitation grants ScanAccess in one transaction', async () => {
    const { client, invitation, scanAccess, transaction } = createClient();
    invitation.findUnique.mockResolvedValue(
      createInvitationRow({
        projectId: null,
        scanId: SCAN_ID,
        status: 'ACCEPTED',
        acceptedAt: NOW,
        acceptedByUserId: VIEWER_ID,
      }),
    );

    const result = await new PrismaShareRepository(client).acceptScanInvitation(
      INVITATION_ID,
      SCAN_ID,
      VIEWER_ID,
      NOW,
    );

    expect(result?.status).toBe('ACCEPTED');
    expect(result?.scanId).toBe(SCAN_ID);
    expect(result?.projectId).toBeNull();
    expect(transaction).toHaveBeenCalledOnce();
    expect(invitation.updateMany).toHaveBeenCalledWith({
      where: {
        id: INVITATION_ID,
        scanId: SCAN_ID,
        status: 'PENDING',
        expiresAt: { gt: NOW },
      },
      data: { status: 'ACCEPTED', acceptedAt: NOW, acceptedByUserId: VIEWER_ID },
    });
    expect(scanAccess.upsert).toHaveBeenCalledWith({
      where: { scanId_userId: { scanId: SCAN_ID, userId: VIEWER_ID } },
      create: {
        scanId: SCAN_ID,
        userId: VIEWER_ID,
        role: 'VIEWER',
        invitationId: INVITATION_ID,
        acceptedAt: NOW,
        revokedAt: null,
        deletedAt: null,
      },
      update: {
        role: 'VIEWER',
        invitationId: INVITATION_ID,
        acceptedAt: NOW,
        revokedAt: null,
        deletedAt: null,
      },
    });
  });

  it('acceptScanInvitation returns null when the invitation is no longer pending', async () => {
    const { client, invitation, scanAccess } = createClient();
    invitation.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      new PrismaShareRepository(client).acceptScanInvitation(
        INVITATION_ID,
        SCAN_ID,
        VIEWER_ID,
        NOW,
      ),
    ).resolves.toBeNull();
    expect(scanAccess.upsert).not.toHaveBeenCalled();
  });

  it('listPendingByScan returns only PENDING scan invitations', async () => {
    const { client, invitation } = createClient();

    const result = await new PrismaShareRepository(client).listPendingByScan(SCAN_ID);

    expect(result).toHaveLength(1);
    expect(invitation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { scanId: SCAN_ID, status: 'PENDING' },
        orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
      }),
    );
  });

  it('findActiveScanAccess returns the active access id', async () => {
    const { client, scanAccess } = createClient();

    await expect(
      new PrismaShareRepository(client).findActiveScanAccess(SCAN_ID, VIEWER_ID),
    ).resolves.toEqual({ id: 'scan-access-id' });
    expect(scanAccess.findFirst).toHaveBeenCalledWith({
      where: { scanId: SCAN_ID, userId: VIEWER_ID, revokedAt: null, deletedAt: null },
      select: { id: true },
    });
  });

  it('listActiveScanViewers maps acceptedAt as grantedAt', async () => {
    const { client, scanAccess } = createClient();

    const result = await new PrismaShareRepository(client).listActiveScanViewers(SCAN_ID);

    expect(result).toEqual([
      {
        userId: VIEWER_ID,
        user: { id: VIEWER_ID, email: RECIPIENT_EMAIL },
        grantedAt: NOW,
      },
    ]);
    expect(scanAccess.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { scanId: SCAN_ID, role: 'VIEWER', revokedAt: null, deletedAt: null },
      }),
    );
  });

  it('revokeScanViewerAccess revokes an active scan access', async () => {
    const { client, scanAccess } = createClient();
    scanAccess.findUnique.mockResolvedValue({ id: 'scan-access-id', revokedAt: null });

    await expect(
      new PrismaShareRepository(client).revokeScanViewerAccess(SCAN_ID, VIEWER_ID, NOW),
    ).resolves.toEqual({ revokedAt: NOW });
    expect(scanAccess.update).toHaveBeenCalledWith({
      where: { id: 'scan-access-id' },
      data: { revokedAt: NOW },
      select: { revokedAt: true },
    });
  });

  it('revokeScanViewerAccess returns null when no access record exists', async () => {
    const { client, scanAccess } = createClient();
    scanAccess.findUnique.mockResolvedValue(null);

    await expect(
      new PrismaShareRepository(client).revokeScanViewerAccess(SCAN_ID, VIEWER_ID, NOW),
    ).resolves.toBeNull();
  });

  it('createShareLink stores a reusable link without a recipient', async () => {
    const { client, shareLink } = createClient();

    const result = await new PrismaShareRepository(client).createShareLink({
      projectId: PROJECT_ID,
      createdById: OWNER_ID,
      tokenHash: TOKEN_HASH,
      expiresAt: NOW,
    });

    expect(result.tokenHash).toBe(TOKEN_HASH);
    expect(shareLink.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          projectId: PROJECT_ID,
          createdById: OWNER_ID,
          tokenHash: TOKEN_HASH,
          expiresAt: NOW,
        },
      }),
    );
  });

  it('findShareLinkByTokenHash returns the share link with its project summary', async () => {
    const { client, shareLink } = createClient();
    shareLink.findFirst.mockResolvedValue({
      id: SHARE_LINK_ID,
      projectId: PROJECT_ID,
      scanId: null,
      createdById: OWNER_ID,
      tokenHash: TOKEN_HASH,
      expiresAt: NOW,
      revokedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
      project: {
        id: PROJECT_ID,
        name: 'District 2 Apartment',
        description: null,
        owner: { id: OWNER_ID, email: 'owner@example.com' },
        scans: [],
        _count: { scans: 0 },
      },
      scan: null,
    });

    const result = await new PrismaShareRepository(client).findShareLinkByTokenHash(TOKEN_HASH);

    expect(result?.shareLink.tokenHash).toBe(TOKEN_HASH);
    expect(result?.project).toEqual(
      expect.objectContaining({ id: PROJECT_ID, name: 'District 2 Apartment' }),
    );
    expect(result?.scan).toBeNull();
    expect(shareLink.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tokenHash: TOKEN_HASH,
          OR: [
            { projectId: { not: null }, project: { deletedAt: null } },
            { scanId: { not: null }, scan: { deletedAt: null, project: { deletedAt: null } } },
          ],
        },
      }),
    );
  });

  it('findShareLinkById returns the stored share link', async () => {
    const { client, shareLink } = createClient();

    const result = await new PrismaShareRepository(client).findShareLinkById(SHARE_LINK_ID);

    expect(result).toEqual(expect.objectContaining({ id: SHARE_LINK_ID, tokenHash: TOKEN_HASH }));
    expect(shareLink.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: SHARE_LINK_ID } }),
    );
  });

  it('listShareLinksByResource returns only active links for the resource', async () => {
    const { client, shareLink } = createClient();
    shareLink.findMany.mockResolvedValue([
      {
        id: SHARE_LINK_ID,
        projectId: PROJECT_ID,
        scanId: null,
        createdById: OWNER_ID,
        tokenHash: TOKEN_HASH,
        expiresAt: NOW,
        revokedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]);

    const result = await new PrismaShareRepository(client).listShareLinksByResource({
      projectId: PROJECT_ID,
    });

    expect(result).toHaveLength(1);
    expect(shareLink.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: PROJECT_ID, scanId: null, revokedAt: null },
      }),
    );
  });

  it('revokeShareLink marks an active link revoked', async () => {
    const { client, shareLink } = createClient();
    shareLink.findUnique.mockResolvedValue({
      id: SHARE_LINK_ID,
      projectId: PROJECT_ID,
      scanId: null,
      createdById: OWNER_ID,
      tokenHash: TOKEN_HASH,
      expiresAt: NOW,
      revokedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    });

    const result = await new PrismaShareRepository(client).revokeShareLink(SHARE_LINK_ID, NOW);

    expect(result?.revokedAt).toEqual(NOW);
    expect(shareLink.updateMany).toHaveBeenCalledWith({
      where: { id: SHARE_LINK_ID, revokedAt: null },
      data: { revokedAt: NOW },
    });
  });

  it('revokeShareLink returns null for an already revoked link', async () => {
    const { client, shareLink } = createClient();
    shareLink.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      new PrismaShareRepository(client).revokeShareLink(SHARE_LINK_ID, NOW),
    ).resolves.toBeNull();
  });

  it('grantProjectAccess creates a fresh ProjectAccess when none exists', async () => {
    const { client, projectAccess } = createClient();

    const result = await new PrismaShareRepository(client).grantProjectAccess(
      PROJECT_ID,
      VIEWER_ID,
      SHARE_LINK_ID,
      NOW,
    );

    expect(result).toEqual({ id: 'access-id' });
    expect(projectAccess.upsert).toHaveBeenCalledWith({
      where: { projectId_userId: { projectId: PROJECT_ID, userId: VIEWER_ID } },
      create: {
        projectId: PROJECT_ID,
        userId: VIEWER_ID,
        role: 'VIEWER',
        shareLinkId: SHARE_LINK_ID,
        acceptedAt: NOW,
        revokedAt: null,
        deletedAt: null,
      },
      update: {
        role: 'VIEWER',
        shareLinkId: SHARE_LINK_ID,
        acceptedAt: NOW,
        revokedAt: null,
        deletedAt: null,
        revision: { increment: 1 },
        updatedAt: NOW,
      },
      select: { id: true },
    });
  });

  it('grantScanAccess creates a fresh ScanAccess when none exists', async () => {
    const { client, scanAccess } = createClient();

    const result = await new PrismaShareRepository(client).grantScanAccess(
      SCAN_ID,
      VIEWER_ID,
      SHARE_LINK_ID,
      NOW,
    );

    expect(result).toEqual({ id: 'scan-access-id' });
    expect(scanAccess.upsert).toHaveBeenCalledWith({
      where: { scanId_userId: { scanId: SCAN_ID, userId: VIEWER_ID } },
      create: {
        scanId: SCAN_ID,
        userId: VIEWER_ID,
        role: 'VIEWER',
        shareLinkId: SHARE_LINK_ID,
        acceptedAt: NOW,
        revokedAt: null,
        deletedAt: null,
      },
      update: {
        role: 'VIEWER',
        shareLinkId: SHARE_LINK_ID,
        acceptedAt: NOW,
        revokedAt: null,
        deletedAt: null,
      },
      select: { id: true },
    });
  });

  it('createInvitationIdempotently stores the invitation and rolls up the project', async () => {
    const { client, invitation } = createClient();
    const execute = vi.fn(
      async (_context: unknown, statusCode: number, work: (tx: unknown) => Promise<unknown>) => ({
        body: await work({
          invitation: { updateMany: invitation.updateMany, create: invitation.create },
        }),
        statusCode,
        replayed: false,
      }),
    );
    const repository = new PrismaShareRepository(client, {
      execute,
    } as unknown as PrismaIdempotencyExecutor);
    const context = {
      userId: OWNER_ID,
      operation: 'CREATE_INVITATION' as const,
      parentScope: `project:${PROJECT_ID}`,
      keyHash: 'key-hash',
      requestHash: 'request-hash',
    };
    const result = {
      invitationId: INVITATION_ID,
      invitationUrl: 'https://example.com/invite',
      recipientEmail: RECIPIENT_EMAIL,
      expiresAt: NOW.toISOString(),
      status: 'PENDING' as const,
      sentAt: NOW.toISOString(),
    };

    const outcome = await repository.createInvitationIdempotently(
      {
        id: INVITATION_ID,
        projectId: PROJECT_ID,
        createdById: OWNER_ID,
        recipientEmail: RECIPIENT_EMAIL,
        tokenHash: TOKEN_HASH,
        expiresAt: NOW,
        sentAt: NOW,
      },
      context,
      result,
    );

    expect(execute).toHaveBeenCalledWith(context, 201, expect.any(Function));
    expect(invitation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ id: INVITATION_ID, projectId: PROJECT_ID }) as Record<
          string,
          unknown
        >,
      }),
    );
    expect(outcome.body.invitationId).toBe(INVITATION_ID);
  });

  it('createInvitationIdempotently maps a duplicate to InvitationAlreadySentError', async () => {
    const { client, invitation } = createClient();
    const conflict = new Prisma.PrismaClientKnownRequestError('unique constraint', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['projectId', 'recipientEmail'] },
    });
    invitation.create.mockRejectedValueOnce(conflict);
    const execute = vi.fn(
      async (_context: unknown, statusCode: number, work: (tx: unknown) => Promise<unknown>) => ({
        body: await work({
          invitation: { updateMany: invitation.updateMany, create: invitation.create },
        }),
        statusCode,
        replayed: false,
      }),
    );
    const repository = new PrismaShareRepository(client, {
      execute,
    } as unknown as PrismaIdempotencyExecutor);

    await expect(
      repository.createInvitationIdempotently(
        {
          id: INVITATION_ID,
          projectId: PROJECT_ID,
          createdById: OWNER_ID,
          recipientEmail: RECIPIENT_EMAIL,
          tokenHash: TOKEN_HASH,
          expiresAt: NOW,
          sentAt: NOW,
        },
        {
          userId: OWNER_ID,
          operation: 'CREATE_INVITATION',
          parentScope: `project:${PROJECT_ID}`,
          keyHash: 'key-hash',
          requestHash: 'request-hash',
        },
        {
          invitationId: INVITATION_ID,
          invitationUrl: 'https://example.com/invite',
          recipientEmail: RECIPIENT_EMAIL,
          expiresAt: NOW.toISOString(),
          status: 'PENDING',
          sentAt: NOW.toISOString(),
        },
      ),
    ).rejects.toBeInstanceOf(InvitationAlreadySentError);
  });

  it('createInvitationIdempotently throws when idempotency is not configured', async () => {
    const { client } = createClient();

    await expect(
      new PrismaShareRepository(client).createInvitationIdempotently(
        {
          id: INVITATION_ID,
          projectId: PROJECT_ID,
          createdById: OWNER_ID,
          recipientEmail: RECIPIENT_EMAIL,
          tokenHash: TOKEN_HASH,
          expiresAt: NOW,
          sentAt: NOW,
        },
        {
          userId: OWNER_ID,
          operation: 'CREATE_INVITATION',
          parentScope: `project:${PROJECT_ID}`,
          keyHash: 'key-hash',
          requestHash: 'request-hash',
        },
        {
          invitationId: INVITATION_ID,
          invitationUrl: 'https://example.com/invite',
          recipientEmail: RECIPIENT_EMAIL,
          expiresAt: NOW.toISOString(),
          status: 'PENDING',
          sentAt: NOW.toISOString(),
        },
      ),
    ).rejects.toThrow('Invitation idempotency is not configured');
  });

  it('resendInvitation returns null when the invitation is no longer pending', async () => {
    const { client, invitation } = createClient();
    invitation.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      new PrismaShareRepository(client).resendInvitation(INVITATION_ID, {
        tokenHash: 'c'.repeat(64),
        sentAt: NOW,
        expiresAt: NOW,
      }),
    ).resolves.toBeNull();
  });

  it('revokeViewerAccess revokes an active access inside a transaction when idempotency is configured', async () => {
    const { client, transaction } = createClient();
    const findUnique = vi.fn().mockResolvedValue({
      id: 'access-id',
      revision: 1,
      revokedAt: null,
      project: { ownerId: OWNER_ID },
    });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findUniqueAfterUpdate = vi.fn().mockResolvedValue({ revision: 2 });
    let findUniqueCallCount = 0;
    transaction.mockImplementationOnce(async (operation: unknown) => {
      return (operation as (tx: unknown) => Promise<unknown>)({
        projectAccess: {
          findUnique: vi.fn().mockImplementation(() => {
            findUniqueCallCount += 1;
            return Promise.resolve(
              findUniqueCallCount === 1 ? findUnique() : findUniqueAfterUpdate(),
            );
          }),
          updateMany,
        },
      });
    });
    const repository = new PrismaShareRepository(client, {} as PrismaIdempotencyExecutor);

    const result = await repository.revokeViewerAccess(PROJECT_ID, VIEWER_ID, NOW);

    expect(result).toEqual({ revokedAt: NOW, revision: 2 });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'access-id', revokedAt: null },
      data: { revokedAt: NOW, revision: { increment: 1 }, updatedAt: NOW },
    });
  });

  it('revokeScanViewerAccess returns the existing revokedAt when already revoked', async () => {
    const { client, scanAccess } = createClient();
    scanAccess.findUnique.mockResolvedValue({ id: 'scan-access-id', revokedAt: NOW });

    await expect(
      new PrismaShareRepository(client).revokeScanViewerAccess(SCAN_ID, VIEWER_ID, NOW),
    ).resolves.toEqual({ revokedAt: NOW });
    expect(scanAccess.update).not.toHaveBeenCalled();
  });

  it('createShareLink stores a scan-scope link', async () => {
    const { client, shareLink } = createClient();

    const result = await new PrismaShareRepository(client).createShareLink({
      scanId: SCAN_ID,
      createdById: OWNER_ID,
      tokenHash: TOKEN_HASH,
      expiresAt: NOW,
    });

    expect(result.tokenHash).toBe(TOKEN_HASH);
    expect(shareLink.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          createdById: OWNER_ID,
          tokenHash: TOKEN_HASH,
          expiresAt: NOW,
          scanId: SCAN_ID,
        },
      }),
    );
  });

  it('listShareLinksByResource returns only active links for a scan', async () => {
    const { client, shareLink } = createClient();
    shareLink.findMany.mockResolvedValue([
      {
        id: SHARE_LINK_ID,
        projectId: null,
        scanId: SCAN_ID,
        createdById: OWNER_ID,
        tokenHash: TOKEN_HASH,
        expiresAt: NOW,
        revokedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]);

    const result = await new PrismaShareRepository(client).listShareLinksByResource({
      scanId: SCAN_ID,
    });

    expect(result).toHaveLength(1);
    expect(shareLink.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { scanId: SCAN_ID, projectId: null, revokedAt: null },
      }),
    );
  });

  describe('expirePendingInvitations', () => {
    it('bulk-revokes only PENDING invitations past expiresAt', async () => {
      const { client, invitation } = createClient();
      const now = new Date('2026-08-05T10:00:00.000Z');

      const count = await new PrismaShareRepository(client).expirePendingInvitations(now);

      expect(invitation.updateMany).toHaveBeenCalledWith({
        where: { status: 'PENDING', expiresAt: { lte: now } },
        data: { status: 'REVOKED', revokedAt: now },
      });
      expect(count).toBe(1);
    });

    it('is idempotent: a re-run with nothing left to expire returns zero', async () => {
      const { client, invitation } = createClient();
      invitation.updateMany.mockResolvedValueOnce({ count: 0 });
      const now = new Date('2026-08-05T10:00:00.000Z');

      const count = await new PrismaShareRepository(client).expirePendingInvitations(now);

      expect(count).toBe(0);
    });
  });
});
