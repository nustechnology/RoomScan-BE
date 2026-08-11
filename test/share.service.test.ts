import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import type { Mailer } from '../src/infrastructure/mail/mailer.types.js';
import { ProjectNotFoundError } from '../src/modules/project/project.errors.js';
import {
  AccessAlreadyExistsError,
  CannotAcceptOwnInvitationError,
  InvitationAlreadyAcceptedError,
  InvitationAlreadySentError,
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

const NOW = new Date('2026-07-29T10:00:00.000Z');
const OWNER_ID = 'eb5d278f-c857-45c7-887d-7be65288cb75';
const RECIPIENT_ID = 'f1a2b3c4-d5e6-7890-abcd-ef1234567890';
const OTHER_ID = '8c53d31d-2788-48de-82a0-c4f219ca3701';
const PROJECT_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const INVITATION_ID = 'b1a2c3d4-e5f6-4890-abcd-ef1234567890';
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-ab';
const RECIPIENT_EMAIL = 'recipient@example.com';
const BASE_URL = 'https://invite.roomscan.dev';
const TTL = 7 * 24 * 60 * 60;

function invitationRecord(overrides: Partial<InvitationRecord> = {}): InvitationRecord {
  return {
    id: INVITATION_ID,
    projectId: PROJECT_ID,
    createdById: OWNER_ID,
    recipientEmail: RECIPIENT_EMAIL,
    tokenHash: 'a'.repeat(64),
    status: 'PENDING',
    expiresAt: new Date(NOW.getTime() + TTL * 1000),
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
    findProjectInfo: vi.fn<ShareRepository['findProjectInfo']>().mockResolvedValue({
      name: 'District 2 Apartment',
      ownerId: OWNER_ID,
      ownerEmail: 'owner@example.com',
    }),
    hasUploadedModel: vi.fn<ShareRepository['hasUploadedModel']>().mockResolvedValue(true),
    createInvitation: vi
      .fn<ShareRepository['createInvitation']>()
      .mockResolvedValue(invitationRecord()),
    findByTokenHash: vi
      .fn<ShareRepository['findByTokenHash']>()
      .mockResolvedValue(invitationWithProject()),
    findByProjectAndEmail: vi
      .fn<ShareRepository['findByProjectAndEmail']>()
      .mockResolvedValue(null),
    findInvitationById: vi
      .fn<ShareRepository['findInvitationById']>()
      .mockResolvedValue(invitationRecord()),
    acceptInvitation: vi
      .fn<ShareRepository['acceptInvitation']>()
      .mockResolvedValue(
        invitationRecord({ status: 'ACCEPTED', acceptedAt: NOW, acceptedByUserId: RECIPIENT_ID }),
      ),
    declineInvitation: vi
      .fn<ShareRepository['declineInvitation']>()
      .mockResolvedValue(invitationRecord({ status: 'DECLINED', declinedAt: NOW })),
    revokeInvitation: vi
      .fn<ShareRepository['revokeInvitation']>()
      .mockResolvedValue(invitationRecord({ status: 'REVOKED', revokedAt: NOW })),
    resendInvitation: vi
      .fn<ShareRepository['resendInvitation']>()
      .mockResolvedValue(invitationRecord({ sentAt: NOW })),
    listPendingByProject: vi
      .fn<ShareRepository['listPendingByProject']>()
      .mockResolvedValue([invitationRecord()]),
    findActiveViewerAccess: vi
      .fn<ShareRepository['findActiveViewerAccess']>()
      .mockResolvedValue(null),
    listActiveViewers: vi.fn<ShareRepository['listActiveViewers']>().mockResolvedValue([
      {
        userId: RECIPIENT_ID,
        user: { id: RECIPIENT_ID, email: RECIPIENT_EMAIL },
        grantedAt: NOW,
      },
    ]),
    revokeViewerAccess: vi
      .fn<ShareRepository['revokeViewerAccess']>()
      .mockResolvedValue({ revokedAt: NOW }),
  };
  const repository: ShareRepository = { ...mocks, ...overrides };
  const sendMail = vi.fn<Mailer['sendMail']>().mockResolvedValue(undefined);
  const service = new ShareService({
    repository,
    mailer: { sendMail },
    logger: pino({ enabled: false }),
    clock: () => NOW,
    invitationTtlSeconds: TTL,
    invitationBaseUrl: BASE_URL,
  });
  return { service, mocks, sendMail };
}

describe('ShareService.createInvitation', () => {
  it('creates a PENDING invitation for the owner and sends the invitation email', async () => {
    const { service, mocks, sendMail } = createService();

    const result = await service.createInvitation(OWNER_ID, PROJECT_ID, {
      recipientEmail: RECIPIENT_EMAIL,
    });

    expect(result).toEqual(
      expect.objectContaining({
        invitationId: INVITATION_ID,
        recipientEmail: RECIPIENT_EMAIL,
        expiresAt: new Date(NOW.getTime() + TTL * 1000).toISOString(),
        status: 'PENDING',
        sentAt: NOW.toISOString(),
      }),
    );
    expect(result.invitationUrl).toContain(`${BASE_URL}/invitations/`);
    expect(mocks.createInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        createdById: OWNER_ID,
        recipientEmail: RECIPIENT_EMAIL,
        expiresAt: new Date(NOW.getTime() + TTL * 1000),
        sentAt: NOW,
      }),
    );
    const createData = mocks.createInvitation.mock.calls[0]?.[0];
    expect(createData?.tokenHash).toMatch(/^[0-9a-f]{64}$/);

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: RECIPIENT_EMAIL,
      }),
    );
    const message = sendMail.mock.calls[0]?.[0];
    expect(message?.subject).toContain('shared a Project with you: District 2 Apartment');
    expect(message?.html).toContain('View Project Invitation');
  });

  it('applies the requested expiresInSeconds', async () => {
    const { service } = createService();

    const result = await service.createInvitation(OWNER_ID, PROJECT_ID, {
      recipientEmail: RECIPIENT_EMAIL,
      expiresInSeconds: 3600,
    });

    expect(result.expiresAt).toBe(new Date(NOW.getTime() + 3600 * 1000).toISOString());
  });

  it('rejects when the project is missing or deleted', async () => {
    const { service, mocks } = createService({
      findProjectInfo: vi.fn().mockResolvedValue(null),
    });

    await expect(
      service.createInvitation(OWNER_ID, PROJECT_ID, { recipientEmail: RECIPIENT_EMAIL }),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
    expect(mocks.createInvitation).not.toHaveBeenCalled();
  });

  it('rejects a non-owner with NotOwnerError', async () => {
    const { service, mocks } = createService({
      findProjectInfo: vi.fn().mockResolvedValue({
        name: 'District 2 Apartment',
        ownerId: OWNER_ID,
        ownerEmail: 'owner@example.com',
      }),
    });

    await expect(
      service.createInvitation(OTHER_ID, PROJECT_ID, { recipientEmail: RECIPIENT_EMAIL }),
    ).rejects.toBeInstanceOf(NotOwnerError);
    expect(mocks.createInvitation).not.toHaveBeenCalled();
  });

  it('rejects when the project has no uploaded model', async () => {
    const { service } = createService({
      hasUploadedModel: vi.fn().mockResolvedValue(false),
    });

    await expect(
      service.createInvitation(OWNER_ID, PROJECT_ID, { recipientEmail: RECIPIENT_EMAIL }),
    ).rejects.toBeInstanceOf(ProjectNotShareableError);
  });

  it('rejects a duplicate pending invitation for the same email', async () => {
    const { service, mocks } = createService({
      findByProjectAndEmail: vi.fn().mockResolvedValue(invitationRecord()),
    });

    await expect(
      service.createInvitation(OWNER_ID, PROJECT_ID, { recipientEmail: RECIPIENT_EMAIL }),
    ).rejects.toBeInstanceOf(InvitationAlreadySentError);
    expect(mocks.createInvitation).not.toHaveBeenCalled();
  });

  it('still creates the invitation when the email fails to send', async () => {
    const { service, sendMail } = createService();
    sendMail.mockRejectedValueOnce(new Error('smtp unavailable'));

    await expect(
      service.createInvitation(OWNER_ID, PROJECT_ID, { recipientEmail: RECIPIENT_EMAIL }),
    ).resolves.toEqual(expect.objectContaining({ status: 'PENDING' }));
  });
});

describe('ShareService.previewInvitation', () => {
  it('returns the safe project summary and the recipient email', async () => {
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
      recipientEmail: RECIPIENT_EMAIL,
      sentAt: NOW.toISOString(),
      expiresAt: new Date(NOW.getTime() + TTL * 1000).toISOString(),
    });
    expect(result.hasAccess).toBeUndefined();
    expect(mocks.findByTokenHash).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f]{64}$/));
  });

  it.each([
    ['EXPIRED', invitationWithProject({ expiresAt: new Date(NOW.getTime() - 1000) })],
    ['ACCEPTED', invitationWithProject({ status: 'ACCEPTED', acceptedAt: NOW })],
    ['DECLINED', invitationWithProject({ status: 'DECLINED', declinedAt: NOW })],
    ['REVOKED', invitationWithProject({ status: 'REVOKED', revokedAt: NOW })],
  ])('reports a %s status', async (status, invitation) => {
    const { service } = createService({
      findByTokenHash: vi.fn().mockResolvedValue(invitation),
    });

    const result = await service.previewInvitation(TOKEN);

    expect(result.status).toBe(status);
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
      invitationId: INVITATION_ID,
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
      INVITATION_ID,
      PROJECT_ID,
      RECIPIENT_ID,
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
      'already accepted',
      invitationWithProject({ status: 'ACCEPTED', acceptedAt: NOW }),
      InvitationAlreadyAcceptedError,
    ],
    [
      'already declined',
      invitationWithProject({ status: 'DECLINED', declinedAt: NOW }),
      InvitationDeclinedError,
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

  it('rejects when the acceptance race is lost', async () => {
    const { service } = createService({
      acceptInvitation: vi.fn().mockResolvedValue(null),
    });

    await expect(service.acceptInvitation(RECIPIENT_ID, TOKEN)).rejects.toBeInstanceOf(
      InvitationAlreadyAcceptedError,
    );
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
    expect(mocks.declineInvitation).toHaveBeenCalledWith(INVITATION_ID, NOW);
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
    const { service, mocks } = createService();

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

  it.each([
    [
      'accepted',
      invitationRecord({ status: 'ACCEPTED', acceptedAt: NOW }),
      InvitationAlreadyAcceptedError,
    ],
    [
      'declined',
      invitationRecord({ status: 'DECLINED', declinedAt: NOW }),
      InvitationDeclinedError,
    ],
    [
      'expired',
      invitationRecord({ expiresAt: new Date(NOW.getTime() - 1) }),
      InvitationExpiredError,
    ],
  ])('rejects revoking an invitation that is %s', async (_label, record, errorClass) => {
    const { service } = createService({
      findInvitationById: vi.fn().mockResolvedValue(record),
    });

    await expect(service.revokeInvitation(OWNER_ID, INVITATION_ID)).rejects.toBeInstanceOf(
      errorClass,
    );
  });
});

describe('ShareService.resendInvitation', () => {
  it('refreshes the link, extends the expiry, and re-sends the email', async () => {
    const { service, mocks, sendMail } = createService();

    const result = await service.resendInvitation(OWNER_ID, INVITATION_ID);

    expect(result).toEqual(
      expect.objectContaining({
        invitationId: INVITATION_ID,
        recipientEmail: RECIPIENT_EMAIL,
        status: 'PENDING',
        sentAt: NOW.toISOString(),
        expiresAt: new Date(NOW.getTime() + TTL * 1000).toISOString(),
      }),
    );
    expect(result.invitationUrl).toContain(`${BASE_URL}/invitations/`);
    const resendData = mocks.resendInvitation.mock.calls[0]?.[0];
    expect(resendData).toBe(INVITATION_ID);
    const resendInput = mocks.resendInvitation.mock.calls[0]?.[1];
    expect(resendInput?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: RECIPIENT_EMAIL,
      }),
    );
  });

  it('rejects an unknown invitation', async () => {
    const { service } = createService({
      findInvitationById: vi.fn().mockResolvedValue(null),
    });

    await expect(service.resendInvitation(OWNER_ID, INVITATION_ID)).rejects.toBeInstanceOf(
      InvitationNotFoundError,
    );
  });

  it('rejects a non-owner', async () => {
    const { service } = createService();

    await expect(service.resendInvitation(OTHER_ID, INVITATION_ID)).rejects.toBeInstanceOf(
      NotOwnerError,
    );
  });

  it.each([
    ['revoked', invitationRecord({ status: 'REVOKED', revokedAt: NOW }), InvitationRevokedError],
    [
      'accepted',
      invitationRecord({ status: 'ACCEPTED', acceptedAt: NOW }),
      InvitationAlreadyAcceptedError,
    ],
    [
      'declined',
      invitationRecord({ status: 'DECLINED', declinedAt: NOW }),
      InvitationDeclinedError,
    ],
    [
      'expired',
      invitationRecord({ expiresAt: new Date(NOW.getTime() - 1) }),
      InvitationExpiredError,
    ],
  ])('rejects resending an invitation that is %s', async (_label, record, errorClass) => {
    const { service } = createService({
      findInvitationById: vi.fn().mockResolvedValue(record),
    });

    await expect(service.resendInvitation(OWNER_ID, INVITATION_ID)).rejects.toBeInstanceOf(
      errorClass,
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
          recipientEmail: RECIPIENT_EMAIL,
          status: 'PENDING',
          sentAt: NOW.toISOString(),
          expiresAt: new Date(NOW.getTime() + TTL * 1000).toISOString(),
        },
      ],
      viewers: [
        {
          userId: RECIPIENT_ID,
          recipientUser: { id: RECIPIENT_ID, email: RECIPIENT_EMAIL },
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
