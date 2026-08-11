import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaShareRepository } from '../src/infrastructure/database/prisma-share-repository.js';

const PROJECT_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const OWNER_ID = 'eb5d278f-c857-45c7-887d-7be65288cb75';
const VIEWER_ID = '8c53d31d-2788-48de-82a0-c4f219ca3701';
const INVITATION_ID = 'b1a2c3d4-e5f6-4890-abcd-ef1234567890';
const TOKEN_HASH = 'a'.repeat(64);
const RECIPIENT_EMAIL = 'recipient@example.com';
const NOW = new Date('2026-07-29T10:00:00.000Z');

function createInvitationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: INVITATION_ID,
    projectId: PROJECT_ID,
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
    findUnique: vi.fn().mockResolvedValue({ id: 'access-id', revokedAt: null }),
    upsert: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({ revokedAt: NOW }),
    findMany: vi.fn().mockResolvedValue([
      {
        userId: VIEWER_ID,
        acceptedAt: NOW,
        createdAt: NOW,
        user: { id: VIEWER_ID, email: RECIPIENT_EMAIL },
      },
    ]),
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
          findUnique: typeof invitation.findUnique;
        };
        projectAccess: { upsert: typeof projectAccess.upsert };
      }) => Promise<unknown>
    )({
      invitation: { updateMany: invitation.updateMany, findUnique: invitation.findUnique },
      projectAccess: { upsert: projectAccess.upsert },
    });
  });
  const client = {
    invitation,
    projectAccess,
    project,
    scan,
    $transaction: transaction,
  } as unknown as Pick<
    PrismaClient,
    'invitation' | 'projectAccess' | 'project' | 'scan' | '$transaction'
  >;

  return { client, invitation, projectAccess, project, scan, transaction };
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

  it('createInvitation stores the recipient and only the token hash', async () => {
    const { client, invitation } = createClient();

    await new PrismaShareRepository(client).createInvitation({
      projectId: PROJECT_ID,
      createdById: OWNER_ID,
      recipientEmail: RECIPIENT_EMAIL,
      tokenHash: TOKEN_HASH,
      expiresAt: NOW,
      sentAt: NOW,
    });

    expect(invitation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          projectId: PROJECT_ID,
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

  it('findByTokenHash returns the invitation with its project summary', async () => {
    const { client, invitation } = createClient();
    invitation.findFirst.mockResolvedValue({
      ...createInvitationRow(),
      project: {
        id: PROJECT_ID,
        name: 'District 2 Apartment',
        description: null,
        owner: { id: OWNER_ID, email: 'owner@example.com' },
      },
    });

    const result = await new PrismaShareRepository(client).findByTokenHash(TOKEN_HASH);

    expect(result?.invitation.recipientEmail).toBe(RECIPIENT_EMAIL);
    expect(result?.invitation.tokenHash).toBe(TOKEN_HASH);
    expect(result?.project).toEqual({
      id: PROJECT_ID,
      name: 'District 2 Apartment',
      description: null,
      thumbnail: null,
      owner: { id: OWNER_ID, email: 'owner@example.com' },
    });
    expect(invitation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tokenHash: TOKEN_HASH, project: { deletedAt: null } },
      }),
    );
  });

  it('findByTokenHash returns null for an unknown token', async () => {
    const { client, invitation } = createClient();
    invitation.findFirst.mockResolvedValue(null);

    await expect(new PrismaShareRepository(client).findByTokenHash(TOKEN_HASH)).resolves.toBeNull();
  });

  it('findByProjectAndEmail returns the latest invitation for a recipient', async () => {
    const { client, invitation } = createClient();

    const result = await new PrismaShareRepository(client).findByProjectAndEmail(
      PROJECT_ID,
      RECIPIENT_EMAIL,
    );

    expect(result?.recipientEmail).toBe(RECIPIENT_EMAIL);
    expect(invitation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: PROJECT_ID, recipientEmail: RECIPIENT_EMAIL },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
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
      where: { id: INVITATION_ID, status: 'PENDING' },
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
      },
      update: {
        role: 'VIEWER',
        invitationId: INVITATION_ID,
        acceptedAt: NOW,
        revokedAt: null,
      },
    });
  });

  it('acceptInvitation returns null when the invitation is no longer pending', async () => {
    const { client, invitation } = createClient();
    invitation.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      new PrismaShareRepository(client).acceptInvitation(INVITATION_ID, PROJECT_ID, VIEWER_ID, NOW),
    ).resolves.toBeNull();
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
      where: { projectId: PROJECT_ID, userId: VIEWER_ID, revokedAt: null },
      select: { id: true },
    });
  });

  it('listActiveViewers maps the acceptedAt (or createdAt) as grantedAt', async () => {
    const { client, projectAccess } = createClient();
    projectAccess.findMany.mockResolvedValue([
      {
        userId: VIEWER_ID,
        acceptedAt: NOW,
        createdAt: NOW,
        user: { id: VIEWER_ID, email: RECIPIENT_EMAIL },
      },
      {
        userId: '11111111-2222-4333-8444-555555555555',
        acceptedAt: null,
        createdAt: NOW,
        user: { id: '11111111-2222-4333-8444-555555555555', email: null },
      },
    ]);

    const result = await new PrismaShareRepository(client).listActiveViewers(PROJECT_ID);

    expect(result).toEqual([
      {
        userId: VIEWER_ID,
        user: { id: VIEWER_ID, email: RECIPIENT_EMAIL },
        grantedAt: NOW,
      },
      {
        userId: '11111111-2222-4333-8444-555555555555',
        user: { id: '11111111-2222-4333-8444-555555555555', email: null },
        grantedAt: NOW,
      },
    ]);
    expect(projectAccess.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: PROJECT_ID, role: 'VIEWER', revokedAt: null },
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
    projectAccess.findUnique.mockResolvedValue({ id: 'access-id', revokedAt: NOW });

    await expect(
      new PrismaShareRepository(client).revokeViewerAccess(PROJECT_ID, VIEWER_ID, NOW),
    ).resolves.toEqual({ revokedAt: NOW });
    expect(projectAccess.update).not.toHaveBeenCalled();
  });

  it('revokeViewerAccess revokes an active access idempotently', async () => {
    const { client, projectAccess } = createClient();
    projectAccess.findUnique.mockResolvedValue({ id: 'access-id', revokedAt: null });

    await expect(
      new PrismaShareRepository(client).revokeViewerAccess(PROJECT_ID, VIEWER_ID, NOW),
    ).resolves.toEqual({ revokedAt: NOW });
    expect(projectAccess.update).toHaveBeenCalledWith({
      where: { id: 'access-id' },
      data: { revokedAt: NOW },
      select: { revokedAt: true },
    });
  });
});
