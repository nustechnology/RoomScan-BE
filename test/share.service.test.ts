import { describe, expect, it, vi } from 'vitest';

import {
  AccessAlreadyExistsError,
  CannotAcceptOwnInvitationError,
  InvitationDeclinedError,
  InvitationExpiredError,
  InvitationNotFoundError,
  InvitationRevokedError,
  NotOwnerError,
  ProjectNotShareableError,
  ViewerAccessNotFoundError,
} from '../src/modules/share/share.errors.js';
import { ShareService } from '../src/modules/share/share.service.js';
import type { InvitationRecord, ShareRepository } from '../src/modules/share/share.types.js';
import { ProjectNotFoundError } from '../src/modules/project/project.errors.js';

const NOW = new Date('2026-07-29T10:00:00.000Z');
const OWNER_ID = 'eb5d278f-c857-45c7-887d-7be65288cb75';
const RECIPIENT_ID = 'f1a2b3c4-d5e6-7890-abcd-ef1234567890';
const OTHER_ID = '8c53d31d-2788-48de-82a0-c4f219ca3701';
const PROJECT_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const INVITATION_ID = 'b1a2c3d4-e5f6-4890-abcd-ef1234567890';
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-ab';
const BASE_URL = 'https://invite.roomscan.dev';
const TTL = 7 * 24 * 60 * 60;

function invitationRecord(overrides: Partial<InvitationRecord> = {}): InvitationRecord {
  return {
    id: INVITATION_ID,
    projectId: PROJECT_ID,
    createdById: OWNER_ID,
    tokenHash: 'a'.repeat(64),
    status: 'PENDING',
    expiresAt: new Date(NOW.getTime() + TTL * 1000),
    sentAt: NOW,
    revokedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function invitationWithProject(overrides: Partial<InvitationRecord> = {}) {
  return {
    invitation: invitationRecord(overrides),
    project: {
      id: PROJECT_ID,
      name: 'District 2 Apartment',
      description: null,
      thumbnail: null,
      owner: { id: OWNER_ID, email: 'owner@example.com' },
    },
  };
}

function createService(overrides: Partial<ShareRepository> = {}) {
  const mocks = {
    findProjectOwner: vi.fn<ShareRepository['findProjectOwner']>().mockResolvedValue(OWNER_ID),
    hasUploadedModel: vi.fn<ShareRepository['hasUploadedModel']>().mockResolvedValue(true),
    createInvitation: vi
      .fn<ShareRepository['createInvitation']>()
      .mockResolvedValue(invitationRecord()),
    findByTokenHash: vi
      .fn<ShareRepository['findByTokenHash']>()
      .mockResolvedValue(invitationWithProject()),
    findInvitationById: vi
      .fn<ShareRepository['findInvitationById']>()
      .mockResolvedValue(invitationRecord()),
    revokeInvitation: vi
      .fn<ShareRepository['revokeInvitation']>()
      .mockResolvedValue(invitationRecord({ status: 'REVOKED', revokedAt: NOW })),
    listPendingByProject: vi
      .fn<ShareRepository['listPendingByProject']>()
      .mockResolvedValue([invitationRecord()]),
    findActiveViewerAccess: vi
      .fn<ShareRepository['findActiveViewerAccess']>()
      .mockResolvedValue(null),
    findDeclinedAccess: vi.fn<ShareRepository['findDeclinedAccess']>().mockResolvedValue(null),
    acceptInvitation: vi.fn<ShareRepository['acceptInvitation']>().mockResolvedValue(undefined),
    declineInvitation: vi.fn<ShareRepository['declineInvitation']>().mockResolvedValue(undefined),
    listActiveViewers: vi.fn<ShareRepository['listActiveViewers']>().mockResolvedValue([
      {
        userId: RECIPIENT_ID,
        user: { id: RECIPIENT_ID, email: 'recipient@example.com' },
        grantedAt: NOW,
      },
    ]),
    revokeViewerAccess: vi
      .fn<ShareRepository['revokeViewerAccess']>()
      .mockResolvedValue({ revokedAt: NOW }),
  };
  const repository: ShareRepository = { ...mocks, ...overrides };
  const service = new ShareService({
    repository,
    clock: () => NOW,
    invitationTtlSeconds: TTL,
    invitationBaseUrl: BASE_URL,
  });
  return { service, mocks };
}

describe('ShareService.createInvitation', () => {
  it('creates a PENDING invitation for the owner and returns the invitation URL', async () => {
    const { service, mocks } = createService();

    const result = await service.createInvitation(OWNER_ID, PROJECT_ID, {});

    expect(result).toEqual(
      expect.objectContaining({
        invitationId: INVITATION_ID,
        expiresAt: new Date(NOW.getTime() + TTL * 1000).toISOString(),
        status: 'PENDING',
      }),
    );
    expect(result.invitationUrl).toContain(`${BASE_URL}/invitations/`);
    expect(mocks.createInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        createdById: OWNER_ID,
        expiresAt: new Date(NOW.getTime() + TTL * 1000),
        sentAt: NOW,
      }),
    );
    const createData = mocks.createInvitation.mock.calls[0]?.[0];
    expect(createData?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('applies the requested expiresInSeconds', async () => {
    const { service } = createService();

    const result = await service.createInvitation(OWNER_ID, PROJECT_ID, {
      expiresInSeconds: 3600,
    });

    expect(result.expiresAt).toBe(new Date(NOW.getTime() + 3600 * 1000).toISOString());
  });

  it('rejects when the project is missing or deleted', async () => {
    const { service, mocks } = createService({
      findProjectOwner: vi.fn().mockResolvedValue(null),
    });

    await expect(service.createInvitation(OWNER_ID, PROJECT_ID, {})).rejects.toBeInstanceOf(
      ProjectNotFoundError,
    );
    expect(mocks.createInvitation).not.toHaveBeenCalled();
  });

  it('rejects a non-owner with NotOwnerError', async () => {
    const { service, mocks } = createService({
      findProjectOwner: vi.fn().mockResolvedValue(OWNER_ID),
    });

    await expect(service.createInvitation(OTHER_ID, PROJECT_ID, {})).rejects.toBeInstanceOf(
      NotOwnerError,
    );
    expect(mocks.createInvitation).not.toHaveBeenCalled();
  });

  it('rejects when the project has no uploaded model', async () => {
    const { service } = createService({
      hasUploadedModel: vi.fn().mockResolvedValue(false),
    });

    await expect(service.createInvitation(OWNER_ID, PROJECT_ID, {})).rejects.toBeInstanceOf(
      ProjectNotShareableError,
    );
  });
});

describe('ShareService.previewInvitation', () => {
  it('returns the safe project summary and a PENDING status', async () => {
    const { service, mocks } = createService();

    const result = await service.previewInvitation(TOKEN);

    expect(result).toEqual({
      project: {
        id: PROJECT_ID,
        name: 'District 2 Apartment',
        description: null,
        thumbnail: null,
      },
      status: 'PENDING',
      sentAt: NOW.toISOString(),
      expiresAt: new Date(NOW.getTime() + TTL * 1000).toISOString(),
    });
    expect(result.hasAccess).toBeUndefined();
    expect(mocks.findByTokenHash).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f]{64}$/));
  });

  it('reports an EXPIRED status for a pending-but-expired invitation', async () => {
    const { service } = createService({
      findByTokenHash: vi.fn().mockResolvedValue(
        invitationWithProject({
          expiresAt: new Date(NOW.getTime() - 1000),
        }),
      ),
    });

    const result = await service.previewInvitation(TOKEN);

    expect(result.status).toBe('EXPIRED');
  });

  it('reports a REVOKED status for a revoked invitation', async () => {
    const { service } = createService({
      findByTokenHash: vi
        .fn()
        .mockResolvedValue(invitationWithProject({ status: 'REVOKED', revokedAt: NOW })),
    });

    const result = await service.previewInvitation(TOKEN);

    expect(result.status).toBe('REVOKED');
  });

  it('rejects an unknown token with InvitationNotFoundError', async () => {
    const { service } = createService({
      findByTokenHash: vi.fn().mockResolvedValue(null),
    });

    await expect(service.previewInvitation(TOKEN)).rejects.toBeInstanceOf(InvitationNotFoundError);
  });

  it('reports hasAccess for an authenticated user with active access', async () => {
    const { service } = createService({
      findActiveViewerAccess: vi.fn().mockResolvedValue({ id: 'access-id' }),
    });

    const result = await service.previewInvitation(TOKEN, RECIPIENT_ID);

    expect(result.hasAccess).toBe(true);
  });

  it('reports hasAccess false for an authenticated user without access', async () => {
    const { service } = createService();

    const result = await service.previewInvitation(TOKEN, RECIPIENT_ID);

    expect(result.hasAccess).toBe(false);
  });
});

describe('ShareService.acceptInvitation', () => {
  it('grants active Viewer access and returns the shared project summary', async () => {
    const { service, mocks } = createService();

    const result = await service.acceptInvitation(RECIPIENT_ID, TOKEN);

    expect(result).toEqual({
      project: {
        id: PROJECT_ID,
        name: 'District 2 Apartment',
        description: null,
        thumbnail: null,
        owner: { id: OWNER_ID, email: 'owner@example.com' },
      },
      access: { role: 'VIEWER', status: 'ACTIVE', grantedAt: NOW.toISOString() },
    });
    expect(mocks.acceptInvitation).toHaveBeenCalledWith(
      PROJECT_ID,
      RECIPIENT_ID,
      INVITATION_ID,
      NOW,
    );
  });

  it.each([
    [
      'revoked',
      invitationWithProject({ status: 'REVOKED', revokedAt: NOW }),
      InvitationRevokedError,
    ],
    [
      'expired',
      invitationWithProject({ expiresAt: new Date(NOW.getTime() - 1) }),
      InvitationExpiredError,
    ],
  ])('rejects an invitation that is %s', async (_label, invitation, errorClass) => {
    const { service, mocks } = createService({
      findByTokenHash: vi.fn().mockResolvedValue(invitation),
    });

    await expect(service.acceptInvitation(RECIPIENT_ID, TOKEN)).rejects.toBeInstanceOf(errorClass);
    expect(mocks.acceptInvitation).not.toHaveBeenCalled();
  });

  it('rejects an unknown token', async () => {
    const { service } = createService({
      findByTokenHash: vi.fn().mockResolvedValue(null),
    });

    await expect(service.acceptInvitation(RECIPIENT_ID, TOKEN)).rejects.toBeInstanceOf(
      InvitationNotFoundError,
    );
  });

  it('rejects the project owner accepting their own invitation', async () => {
    const { service, mocks } = createService();

    await expect(service.acceptInvitation(OWNER_ID, TOKEN)).rejects.toBeInstanceOf(
      CannotAcceptOwnInvitationError,
    );
    expect(mocks.acceptInvitation).not.toHaveBeenCalled();
  });

  it('rejects a user that already has active access', async () => {
    const { service, mocks } = createService({
      findActiveViewerAccess: vi.fn().mockResolvedValue({ id: 'access-id' }),
    });

    await expect(service.acceptInvitation(RECIPIENT_ID, TOKEN)).rejects.toBeInstanceOf(
      AccessAlreadyExistsError,
    );
    expect(mocks.acceptInvitation).not.toHaveBeenCalled();
  });

  it('rejects a user that already declined this invitation', async () => {
    const { service, mocks } = createService({
      findDeclinedAccess: vi.fn().mockResolvedValue({ id: 'access-id' }),
    });

    await expect(service.acceptInvitation(RECIPIENT_ID, TOKEN)).rejects.toBeInstanceOf(
      InvitationDeclinedError,
    );
    expect(mocks.acceptInvitation).not.toHaveBeenCalled();
  });
});

describe('ShareService.declineInvitation', () => {
  it('records the decline and returns the updated status', async () => {
    const { service, mocks } = createService();

    const result = await service.declineInvitation(RECIPIENT_ID, TOKEN);

    expect(result).toEqual({
      invitationId: INVITATION_ID,
      status: 'DECLINED',
      declinedAt: NOW.toISOString(),
    });
    expect(mocks.declineInvitation).toHaveBeenCalledWith(
      PROJECT_ID,
      RECIPIENT_ID,
      INVITATION_ID,
      NOW,
    );
  });

  it('rejects a user that already has active access', async () => {
    const { service, mocks } = createService({
      findActiveViewerAccess: vi.fn().mockResolvedValue({ id: 'access-id' }),
    });

    await expect(service.declineInvitation(RECIPIENT_ID, TOKEN)).rejects.toBeInstanceOf(
      AccessAlreadyExistsError,
    );
    expect(mocks.declineInvitation).not.toHaveBeenCalled();
  });
});

describe('ShareService.revokeInvitation', () => {
  it('revokes a pending invitation as the owner', async () => {
    const { service, mocks } = createService();

    const result = await service.revokeInvitation(OWNER_ID, INVITATION_ID);

    expect(result).toEqual({
      invitationId: INVITATION_ID,
      status: 'REVOKED',
      revokedAt: NOW.toISOString(),
    });
    expect(mocks.revokeInvitation).toHaveBeenCalledWith(INVITATION_ID, NOW);
  });

  it('rejects an unknown invitation', async () => {
    const { service } = createService({
      findInvitationById: vi.fn().mockResolvedValue(null),
    });

    await expect(service.revokeInvitation(OWNER_ID, INVITATION_ID)).rejects.toBeInstanceOf(
      InvitationNotFoundError,
    );
  });

  it('rejects a non-owner with NotOwnerError', async () => {
    const { service, mocks } = createService({
      findProjectOwner: vi.fn().mockResolvedValue(OWNER_ID),
    });

    await expect(service.revokeInvitation(OTHER_ID, INVITATION_ID)).rejects.toBeInstanceOf(
      NotOwnerError,
    );
    expect(mocks.revokeInvitation).not.toHaveBeenCalled();
  });

  it('is idempotent for an already revoked invitation', async () => {
    const { service, mocks } = createService({
      findInvitationById: vi
        .fn()
        .mockResolvedValue(invitationRecord({ status: 'REVOKED', revokedAt: NOW })),
    });

    const result = await service.revokeInvitation(OWNER_ID, INVITATION_ID);

    expect(result).toEqual({
      invitationId: INVITATION_ID,
      status: 'REVOKED',
      revokedAt: NOW.toISOString(),
    });
    expect(mocks.revokeInvitation).not.toHaveBeenCalled();
  });

  it('rejects revoking an expired invitation', async () => {
    const { service } = createService({
      findInvitationById: vi
        .fn()
        .mockResolvedValue(invitationRecord({ expiresAt: new Date(NOW.getTime() - 1) })),
    });

    await expect(service.revokeInvitation(OWNER_ID, INVITATION_ID)).rejects.toBeInstanceOf(
      InvitationExpiredError,
    );
  });
});

describe('ShareService.listShares', () => {
  it('lists pending invitations and active viewers for the owner', async () => {
    const { service } = createService();

    const result = await service.listShares(OWNER_ID, PROJECT_ID);

    expect(result).toEqual({
      pendingInvitations: [
        {
          invitationId: INVITATION_ID,
          status: 'PENDING',
          sentAt: NOW.toISOString(),
          expiresAt: new Date(NOW.getTime() + TTL * 1000).toISOString(),
        },
      ],
      viewers: [
        {
          userId: RECIPIENT_ID,
          recipientUser: { id: RECIPIENT_ID, email: 'recipient@example.com' },
          grantedAt: NOW.toISOString(),
        },
      ],
    });
  });

  it('labels an expired pending invitation as EXPIRED', async () => {
    const { service } = createService({
      listPendingByProject: vi
        .fn()
        .mockResolvedValue([invitationRecord({ expiresAt: new Date(NOW.getTime() - 1) })]),
    });

    const result = await service.listShares(OWNER_ID, PROJECT_ID);

    expect(result.pendingInvitations[0]?.status).toBe('EXPIRED');
  });

  it('rejects a non-owner', async () => {
    const { service } = createService();

    await expect(service.listShares(OTHER_ID, PROJECT_ID)).rejects.toBeInstanceOf(NotOwnerError);
  });

  it('rejects a missing project', async () => {
    const { service } = createService({
      findProjectOwner: vi.fn().mockResolvedValue(null),
    });

    await expect(service.listShares(OWNER_ID, PROJECT_ID)).rejects.toBeInstanceOf(
      ProjectNotFoundError,
    );
  });
});

describe('ShareService.revokeViewer', () => {
  it('revokes Viewer access for the owner', async () => {
    const { service, mocks } = createService();

    const result = await service.revokeViewer(OWNER_ID, PROJECT_ID, RECIPIENT_ID);

    expect(result).toEqual({
      projectId: PROJECT_ID,
      userId: RECIPIENT_ID,
      revokedAt: NOW.toISOString(),
    });
    expect(mocks.revokeViewerAccess).toHaveBeenCalledWith(PROJECT_ID, RECIPIENT_ID, NOW);
  });

  it('returns the existing revokedAt when access was already revoked', async () => {
    const { service } = createService({
      revokeViewerAccess: vi.fn().mockResolvedValue({ revokedAt: NOW }),
    });

    const result = await service.revokeViewer(OWNER_ID, PROJECT_ID, RECIPIENT_ID);

    expect(result.revokedAt).toBe(NOW.toISOString());
  });

  it('rejects when no access record exists', async () => {
    const { service } = createService({
      revokeViewerAccess: vi.fn().mockResolvedValue(null),
    });

    await expect(service.revokeViewer(OWNER_ID, PROJECT_ID, RECIPIENT_ID)).rejects.toBeInstanceOf(
      ViewerAccessNotFoundError,
    );
  });

  it('rejects a non-owner', async () => {
    const { service } = createService();

    await expect(service.revokeViewer(OTHER_ID, PROJECT_ID, RECIPIENT_ID)).rejects.toBeInstanceOf(
      NotOwnerError,
    );
  });
});
