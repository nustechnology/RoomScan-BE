import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaShareRepository } from '../src/infrastructure/database/prisma-share-repository.js';

const PROJECT_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const OWNER_ID = 'eb5d278f-c857-45c7-887d-7be65288cb75';
const VIEWER_ID = '8c53d31d-2788-48de-82a0-c4f219ca3701';
const INVITATION_ID = 'b1a2c3d4-e5f6-4890-abcd-ef1234567890';
const TOKEN_HASH = 'a'.repeat(64);
const NOW = new Date('2026-07-29T10:00:00.000Z');

function createInvitationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: INVITATION_ID,
    projectId: PROJECT_ID,
    createdById: OWNER_ID,
    tokenHash: TOKEN_HASH,
    status: 'PENDING',
    expiresAt: NOW,
    sentAt: NOW,
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
    update: vi.fn().mockResolvedValue(createInvitationRow({ status: 'REVOKED', revokedAt: NOW })),
    findMany: vi.fn().mockResolvedValue([createInvitationRow()]),
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
        user: { id: VIEWER_ID, email: 'viewer@example.com' },
      },
    ]),
  };
  const project = {
    findFirst: vi.fn().mockResolvedValue({ ownerId: OWNER_ID }),
  };
  const scan = {
    findFirst: vi.fn().mockResolvedValue({ id: 'scan-id' }),
  };
  const client = {
    invitation,
    projectAccess,
    project,
    scan,
  } as unknown as Pick<PrismaClient, 'invitation' | 'projectAccess' | 'project' | 'scan'>;

  return { client, invitation, projectAccess, project, scan };
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

  it('createInvitation stores only the token hash with a PENDING status', async () => {
    const { client, invitation } = createClient();

    await new PrismaShareRepository(client).createInvitation({
      projectId: PROJECT_ID,
      createdById: OWNER_ID,
      tokenHash: TOKEN_HASH,
      expiresAt: NOW,
      sentAt: NOW,
    });

    expect(invitation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          projectId: PROJECT_ID,
          createdById: OWNER_ID,
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

    expect(result?.invitation.id).toBe(INVITATION_ID);
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

  it('revokeInvitation marks the invitation as REVOKED', async () => {
    const { client, invitation } = createClient();

    const result = await new PrismaShareRepository(client).revokeInvitation(INVITATION_ID, NOW);

    expect(result).toEqual(expect.objectContaining({ status: 'REVOKED', revokedAt: NOW }));
    expect(invitation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: INVITATION_ID },
        data: { status: 'REVOKED', revokedAt: NOW },
      }),
    );
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

  it('findDeclinedAccess filters on the invitation and a non-null declinedAt', async () => {
    const { client, projectAccess } = createClient();

    await expect(
      new PrismaShareRepository(client).findDeclinedAccess(PROJECT_ID, VIEWER_ID, INVITATION_ID),
    ).resolves.toEqual({ id: 'access-id' });
    expect(projectAccess.findFirst).toHaveBeenCalledWith({
      where: {
        projectId: PROJECT_ID,
        userId: VIEWER_ID,
        invitationId: INVITATION_ID,
        declinedAt: { not: null },
      },
      select: { id: true },
    });
  });

  it('acceptInvitation upserts an active Viewer access', async () => {
    const { client, projectAccess } = createClient();

    await new PrismaShareRepository(client).acceptInvitation(
      PROJECT_ID,
      VIEWER_ID,
      INVITATION_ID,
      NOW,
    );

    expect(projectAccess.upsert).toHaveBeenCalledWith({
      where: { projectId_userId: { projectId: PROJECT_ID, userId: VIEWER_ID } },
      create: {
        projectId: PROJECT_ID,
        userId: VIEWER_ID,
        role: 'VIEWER',
        invitationId: INVITATION_ID,
        acceptedAt: NOW,
        declinedAt: null,
        revokedAt: null,
      },
      update: {
        role: 'VIEWER',
        invitationId: INVITATION_ID,
        acceptedAt: NOW,
        declinedAt: null,
        revokedAt: null,
      },
    });
  });

  it('declineInvitation upserts an inactive declined access', async () => {
    const { client, projectAccess } = createClient();

    await new PrismaShareRepository(client).declineInvitation(
      PROJECT_ID,
      VIEWER_ID,
      INVITATION_ID,
      NOW,
    );

    expect(projectAccess.upsert).toHaveBeenCalledWith({
      where: { projectId_userId: { projectId: PROJECT_ID, userId: VIEWER_ID } },
      create: {
        projectId: PROJECT_ID,
        userId: VIEWER_ID,
        role: 'VIEWER',
        invitationId: INVITATION_ID,
        acceptedAt: null,
        declinedAt: NOW,
        revokedAt: NOW,
      },
      update: {
        invitationId: INVITATION_ID,
        acceptedAt: null,
        declinedAt: NOW,
        revokedAt: NOW,
      },
    });
  });

  it('listActiveViewers maps the acceptedAt (or createdAt) as grantedAt', async () => {
    const { client, projectAccess } = createClient();
    projectAccess.findMany.mockResolvedValue([
      {
        userId: VIEWER_ID,
        acceptedAt: NOW,
        createdAt: NOW,
        user: { id: VIEWER_ID, email: 'viewer@example.com' },
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
        user: { id: VIEWER_ID, email: 'viewer@example.com' },
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
