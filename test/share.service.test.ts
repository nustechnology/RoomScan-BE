import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import type { Mailer } from '../src/infrastructure/mail/mailer.types.js';
import { ProjectNotFoundError } from '../src/modules/project/project.errors.js';
import { ScanNotFoundError } from '../src/modules/scan/scan.errors.js';
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
  ScanNotShareableError,
  ShareLinkExpiredError,
  ShareLinkRevokedError,
  ViewerAccessNotFoundError,
} from '../src/modules/share/share.errors.js';
import { ShareService } from '../src/modules/share/share.service.js';
import type { InvitationRecord, ShareRepository } from '../src/modules/share/share.types.js';

const NOW = new Date('2026-07-29T10:00:00.000Z');
const OWNER_ID = 'eb5d278f-c857-45c7-887d-7be65288cb75';
const RECIPIENT_ID = 'f1a2b3c4-d5e6-7890-abcd-ef1234567890';
const OTHER_ID = '8c53d31d-2788-48de-82a0-c4f219ca3701';
const PROJECT_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const SCAN_ID = 'f1e2d3c4-a5b6-7890-abcd-ef1234567890';
const INVITATION_ID = 'b1a2c3d4-e5f6-4890-abcd-ef1234567890';
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-ab';
const RECIPIENT_EMAIL = 'recipient@example.com';
const BASE_URL = 'https://invite.roomscan.dev';
const TTL = 7 * 24 * 60 * 60;

function invitationRecord(overrides: Partial<InvitationRecord> = {}): InvitationRecord {
  return {
    id: INVITATION_ID,
    projectId: PROJECT_ID,
    scanId: null,
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
    scan: null,
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
    findScanInfo: vi.fn<ShareRepository['findScanInfo']>().mockResolvedValue({
      name: 'Living Room',
      projectId: PROJECT_ID,
      ownerId: OWNER_ID,
      ownerEmail: 'owner@example.com',
    }),
    hasUploadedScanModel: vi.fn<ShareRepository['hasUploadedScanModel']>().mockResolvedValue(true),
    acceptScanInvitation: vi
      .fn<ShareRepository['acceptScanInvitation']>()
      .mockResolvedValue(invitationRecord({ status: 'ACCEPTED', acceptedAt: NOW })),
    listPendingByScan: vi
      .fn<ShareRepository['listPendingByScan']>()
      .mockResolvedValue([invitationRecord()]),
    findActiveScanAccess: vi.fn<ShareRepository['findActiveScanAccess']>().mockResolvedValue(null),
    listActiveScanViewers: vi.fn<ShareRepository['listActiveScanViewers']>().mockResolvedValue([
      {
        userId: RECIPIENT_ID,
        user: { id: RECIPIENT_ID, email: RECIPIENT_EMAIL },
        grantedAt: NOW,
      },
    ]),
    revokeScanViewerAccess: vi
      .fn<ShareRepository['revokeScanViewerAccess']>()
      .mockResolvedValue({ revokedAt: NOW }),
    createShareLink: vi.fn<ShareRepository['createShareLink']>().mockResolvedValue({
      id: 'c0ffee00-0000-4000-8000-0000000000aa',
      projectId: PROJECT_ID,
      scanId: null,
      createdById: OWNER_ID,
      tokenHash: 'b'.repeat(64),
      expiresAt: new Date(NOW.getTime() + TTL * 1000),
      revokedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    }),
    findShareLinkByTokenHash: vi
      .fn<ShareRepository['findShareLinkByTokenHash']>()
      .mockResolvedValue({
        shareLink: {
          id: 'c0ffee00-0000-4000-8000-0000000000aa',
          projectId: PROJECT_ID,
          scanId: null,
          createdById: OWNER_ID,
          tokenHash: 'b'.repeat(64),
          expiresAt: new Date(NOW.getTime() + TTL * 1000),
          revokedAt: null,
          createdAt: NOW,
          updatedAt: NOW,
        },
        project: {
          id: PROJECT_ID,
          name: 'District 2 Apartment',
          description: null,
          thumbnail: null,
          owner: { id: OWNER_ID, email: 'owner@example.com' },
        },
        scan: null,
      }),
    findShareLinkById: vi.fn<ShareRepository['findShareLinkById']>().mockResolvedValue({
      id: 'c0ffee00-0000-4000-8000-0000000000aa',
      projectId: PROJECT_ID,
      scanId: null,
      createdById: OWNER_ID,
      tokenHash: 'b'.repeat(64),
      expiresAt: new Date(NOW.getTime() + TTL * 1000),
      revokedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    }),
    listShareLinksByResource: vi
      .fn<ShareRepository['listShareLinksByResource']>()
      .mockResolvedValue([]),
    revokeShareLink: vi.fn<ShareRepository['revokeShareLink']>().mockResolvedValue({
      id: 'c0ffee00-0000-4000-8000-0000000000aa',
      projectId: PROJECT_ID,
      scanId: null,
      createdById: OWNER_ID,
      tokenHash: 'b'.repeat(64),
      expiresAt: new Date(NOW.getTime() + TTL * 1000),
      revokedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    }),
    grantProjectAccess: vi.fn<ShareRepository['grantProjectAccess']>().mockResolvedValue({
      id: 'access-id',
    }),
    grantScanAccess: vi.fn<ShareRepository['grantScanAccess']>().mockResolvedValue({
      id: 'access-id',
    }),
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

  it('propagates a concurrent duplicate pending invitation as InvitationAlreadySentError', async () => {
    const createInvitation = vi.fn().mockRejectedValue(new InvitationAlreadySentError());
    const { service } = createService({ createInvitation });

    await expect(
      service.createInvitation(OWNER_ID, PROJECT_ID, { recipientEmail: RECIPIENT_EMAIL }),
    ).rejects.toBeInstanceOf(InvitationAlreadySentError);
    expect(createInvitation).toHaveBeenCalled();
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
      type: 'invitation',
      scope: 'project',
      project: {
        id: PROJECT_ID,
        name: 'District 2 Apartment',
        description: null,
        thumbnail: null,
      },
      scan: null,
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
      findShareLinkByTokenHash: vi.fn().mockResolvedValue(null),
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
      type: 'invitation',
      invitationId: INVITATION_ID,
      scope: 'project',
      project: {
        id: PROJECT_ID,
        name: 'District 2 Apartment',
        description: null,
        thumbnail: null,
        owner: { id: OWNER_ID, email: 'owner@example.com' },
      },
      scan: null,
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
      findShareLinkByTokenHash: vi.fn().mockResolvedValue(null),
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

  it('re-sends a scan-scope invitation using the scan email template', async () => {
    const resend = vi
      .fn<ShareRepository['resendInvitation']>()
      .mockResolvedValue(invitationRecord({ projectId: null, scanId: SCAN_ID, sentAt: NOW }));
    const { service, sendMail } = createService({
      findInvitationById: vi
        .fn<ShareRepository['findInvitationById']>()
        .mockResolvedValue(invitationRecord({ projectId: null, scanId: SCAN_ID })),
      resendInvitation: resend,
    });

    const result = await service.resendInvitation(OWNER_ID, INVITATION_ID);

    expect(result).toEqual(
      expect.objectContaining({ status: 'PENDING', recipientEmail: RECIPIENT_EMAIL }),
    );
    expect(result.invitationUrl).toContain(`${BASE_URL}/invitations/`);
    const resendInput = resend.mock.calls[0]?.[1];
    expect(resendInput?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    const message = sendMail.mock.calls[0]?.[0];
    expect(message?.subject).toContain('shared a 3D Scan with you: Living Room');
    expect(message?.html).toContain('View Scan Invitation');
  });

  it('hides a scan invitation whose scan is deleted when resending', async () => {
    const { service, mocks } = createService({
      findInvitationById: vi
        .fn()
        .mockResolvedValue(invitationRecord({ projectId: null, scanId: SCAN_ID })),
      findScanInfo: vi.fn().mockResolvedValue(null),
    });

    await expect(service.resendInvitation(OWNER_ID, INVITATION_ID)).rejects.toBeInstanceOf(
      InvitationNotFoundError,
    );
    expect(mocks.resendInvitation).not.toHaveBeenCalled();
  });

  it('rejects a scan resend when the scan disappears mid-flight', async () => {
    const { service } = createService({
      findInvitationById: vi
        .fn()
        .mockResolvedValue(invitationRecord({ projectId: null, scanId: SCAN_ID })),
      resendInvitation: vi
        .fn()
        .mockResolvedValue(invitationRecord({ projectId: null, scanId: SCAN_ID, sentAt: NOW })),
      findScanInfo: vi
        .fn()
        .mockResolvedValueOnce({
          name: 'Living Room',
          projectId: PROJECT_ID,
          ownerId: OWNER_ID,
          ownerEmail: 'owner@example.com',
        })
        .mockResolvedValueOnce(null),
    });

    await expect(service.resendInvitation(OWNER_ID, INVITATION_ID)).rejects.toBeInstanceOf(
      ProjectNotFoundError,
    );
  });
});

describe('ShareService default clock', () => {
  it('uses the system clock when none is supplied', async () => {
    const { mocks } = createService();
    const service = new ShareService({
      repository: mocks,
      mailer: { sendMail: vi.fn() },
      logger: pino({ enabled: false }),
      invitationTtlSeconds: TTL,
      invitationBaseUrl: BASE_URL,
    });

    const result = await service.createInvitation(OWNER_ID, PROJECT_ID, {
      recipientEmail: RECIPIENT_EMAIL,
    });

    expect(Date.parse(result.sentAt)).toBeGreaterThan(0);
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

function scanInvitationContext(overrides: Partial<InvitationRecord> = {}) {
  return {
    invitation: invitationRecord({ projectId: null, scanId: SCAN_ID, ...overrides }),
    project: null,
    scan: {
      id: SCAN_ID,
      projectId: PROJECT_ID,
      name: 'Living Room',
      description: null,
      thumbnail: null,
      creator: { id: OWNER_ID, email: 'owner@example.com' },
      ownerId: OWNER_ID,
    },
  };
}

function shareLinkContext() {
  return {
    shareLink: {
      id: 'c0ffee00-0000-4000-8000-0000000000aa',
      projectId: PROJECT_ID,
      scanId: null,
      createdById: OWNER_ID,
      tokenHash: 'b'.repeat(64),
      expiresAt: new Date(NOW.getTime() + TTL * 1000),
      revokedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    project: {
      id: PROJECT_ID,
      name: 'District 2 Apartment',
      description: null,
      thumbnail: null,
      owner: { id: OWNER_ID, email: 'owner@example.com' },
    },
    scan: null,
  };
}

function scanShareLinkContext() {
  return {
    shareLink: {
      ...shareLinkContext().shareLink,
      projectId: null,
      scanId: SCAN_ID,
    },
    project: null,
    scan: {
      id: SCAN_ID,
      projectId: PROJECT_ID,
      name: 'Living Room',
      description: null,
      thumbnail: null,
      creator: { id: OWNER_ID, email: 'owner@example.com' },
      ownerId: OWNER_ID,
    },
  };
}

describe('ShareService.createScanInvitation', () => {
  it('creates a PENDING scan invitation and sends the scan-scope email', async () => {
    const { service, mocks, sendMail } = createService();

    const result = await service.createScanInvitation(OWNER_ID, SCAN_ID, {
      recipientEmail: RECIPIENT_EMAIL,
    });

    expect(result).toEqual(
      expect.objectContaining({ status: 'PENDING', recipientEmail: RECIPIENT_EMAIL }),
    );
    expect(result.invitationUrl).toContain(`${BASE_URL}/invitations/`);
    expect(mocks.createInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ scanId: SCAN_ID, createdById: OWNER_ID }),
    );
    const message = sendMail.mock.calls[0]?.[0];
    expect(message?.subject).toContain('shared a 3D Scan with you: Living Room');
    expect(message?.html).toContain('View Scan Invitation');
  });

  it('rejects a missing scan', async () => {
    const { service } = createService({ findScanInfo: vi.fn().mockResolvedValue(null) });

    await expect(
      service.createScanInvitation(OWNER_ID, SCAN_ID, { recipientEmail: RECIPIENT_EMAIL }),
    ).rejects.toBeInstanceOf(ScanNotFoundError);
  });

  it('rejects a non-owner', async () => {
    const { service } = createService({
      findScanInfo: vi.fn().mockResolvedValue({
        name: 'Living Room',
        projectId: PROJECT_ID,
        ownerId: OTHER_ID,
        ownerEmail: null,
      }),
    });

    await expect(
      service.createScanInvitation(OWNER_ID, SCAN_ID, { recipientEmail: RECIPIENT_EMAIL }),
    ).rejects.toBeInstanceOf(NotOwnerError);
  });

  it('rejects when the scan has no uploaded model', async () => {
    const { service } = createService({
      hasUploadedScanModel: vi.fn().mockResolvedValue(false),
    });

    await expect(
      service.createScanInvitation(OWNER_ID, SCAN_ID, { recipientEmail: RECIPIENT_EMAIL }),
    ).rejects.toBeInstanceOf(ScanNotShareableError);
  });
});

describe('ShareService.previewInvitation scan and share-link scopes', () => {
  it('previews a scan-scope invitation', async () => {
    const { service } = createService({
      findByTokenHash: vi.fn().mockResolvedValue(scanInvitationContext()),
    });

    const result = await service.previewInvitation(TOKEN);

    expect(result).toMatchObject({
      type: 'invitation',
      scope: 'scan',
      project: null,
      scan: { id: SCAN_ID, name: 'Living Room' },
      status: 'PENDING',
    });
  });

  it('previews an active project share link', async () => {
    const { service } = createService({ findByTokenHash: vi.fn().mockResolvedValue(null) });

    const result = await service.previewInvitation(TOKEN);

    expect(result).toMatchObject({
      type: 'share-link',
      scope: 'project',
      project: { id: PROJECT_ID, name: 'District 2 Apartment' },
      status: 'ACTIVE',
    });
    expect((result as { recipientEmail?: string }).recipientEmail).toBeUndefined();
  });

  it('reports hasAccess for a share link when the user has active access', async () => {
    const { service } = createService({
      findByTokenHash: vi.fn().mockResolvedValue(null),
      findActiveViewerAccess: vi.fn().mockResolvedValue({ id: 'access-id' }),
    });

    const result = await service.previewInvitation(TOKEN, RECIPIENT_ID);

    expect((result as { hasAccess?: boolean }).hasAccess).toBe(true);
  });

  it('rejects a revoked share link', async () => {
    const { service } = createService({
      findByTokenHash: vi.fn().mockResolvedValue(null),
      findShareLinkByTokenHash: vi.fn().mockResolvedValue({
        ...shareLinkContext(),
        shareLink: { ...shareLinkContext().shareLink, revokedAt: NOW },
      }),
    });

    const result = await service.previewInvitation(TOKEN);

    expect(result).toEqual(expect.objectContaining({ type: 'share-link', status: 'REVOKED' }));
  });
});

describe('ShareService.acceptInvitation scan and share-link scopes', () => {
  it('grants scan-level Viewer access for a scan-scope invitation', async () => {
    const { service, mocks } = createService({
      findByTokenHash: vi.fn().mockResolvedValue(scanInvitationContext()),
    });

    const result = await service.acceptInvitation(RECIPIENT_ID, TOKEN);

    expect(result).toMatchObject({
      type: 'invitation',
      scope: 'scan',
      project: null,
      scan: { id: SCAN_ID, name: 'Living Room' },
      access: { role: 'VIEWER', status: 'ACTIVE', grantedAt: NOW.toISOString() },
    });
    expect(mocks.acceptScanInvitation).toHaveBeenCalledWith(
      INVITATION_ID,
      SCAN_ID,
      RECIPIENT_ID,
      NOW,
    );
  });

  it('rejects the project owner accepting their own scan invitation', async () => {
    const { service, mocks } = createService({
      findByTokenHash: vi.fn().mockResolvedValue(scanInvitationContext()),
    });

    await expect(service.acceptInvitation(OWNER_ID, TOKEN)).rejects.toBeInstanceOf(
      CannotAcceptOwnInvitationError,
    );
    expect(mocks.acceptScanInvitation).not.toHaveBeenCalled();
  });

  it('rejects a scan invitation for a user that already has scan access', async () => {
    const { service, mocks } = createService({
      findByTokenHash: vi.fn().mockResolvedValue(scanInvitationContext()),
      findActiveScanAccess: vi.fn().mockResolvedValue({ id: 'access-id' }),
    });

    await expect(service.acceptInvitation(RECIPIENT_ID, TOKEN)).rejects.toBeInstanceOf(
      AccessAlreadyExistsError,
    );
    expect(mocks.acceptScanInvitation).not.toHaveBeenCalled();
  });

  it('grants Viewer access through a project share link', async () => {
    const { service, mocks } = createService({ findByTokenHash: vi.fn().mockResolvedValue(null) });

    const result = await service.acceptInvitation(RECIPIENT_ID, TOKEN);

    expect(result).toMatchObject({
      type: 'share-link',
      scope: 'project',
      project: { id: PROJECT_ID, name: 'District 2 Apartment' },
      access: { role: 'VIEWER', status: 'ACTIVE', grantedAt: NOW.toISOString() },
    });
    expect(mocks.grantProjectAccess).toHaveBeenCalledWith(
      PROJECT_ID,
      RECIPIENT_ID,
      'c0ffee00-0000-4000-8000-0000000000aa',
      NOW,
    );
  });

  it('rejects an expired share link', async () => {
    const { service, mocks } = createService({
      findByTokenHash: vi.fn().mockResolvedValue(null),
      findShareLinkByTokenHash: vi.fn().mockResolvedValue({
        ...shareLinkContext(),
        shareLink: {
          ...shareLinkContext().shareLink,
          expiresAt: new Date(NOW.getTime() - 1000),
        },
      }),
    });

    await expect(service.acceptInvitation(RECIPIENT_ID, TOKEN)).rejects.toBeInstanceOf(
      ShareLinkExpiredError,
    );
    expect(mocks.grantProjectAccess).not.toHaveBeenCalled();
  });

  it('rejects a revoked share link', async () => {
    const { service, mocks } = createService({
      findByTokenHash: vi.fn().mockResolvedValue(null),
      findShareLinkByTokenHash: vi.fn().mockResolvedValue({
        ...shareLinkContext(),
        shareLink: { ...shareLinkContext().shareLink, revokedAt: NOW },
      }),
    });

    await expect(service.acceptInvitation(RECIPIENT_ID, TOKEN)).rejects.toBeInstanceOf(
      ShareLinkRevokedError,
    );
    expect(mocks.grantProjectAccess).not.toHaveBeenCalled();
  });

  it('rejects the project owner accepting their own share link', async () => {
    const { service, mocks } = createService({ findByTokenHash: vi.fn().mockResolvedValue(null) });

    await expect(service.acceptInvitation(OWNER_ID, TOKEN)).rejects.toBeInstanceOf(
      CannotAcceptOwnInvitationError,
    );
    expect(mocks.grantProjectAccess).not.toHaveBeenCalled();
  });

  it('rejects a share link for a user that already has active access', async () => {
    const { service, mocks } = createService({
      findByTokenHash: vi.fn().mockResolvedValue(null),
      findActiveViewerAccess: vi.fn().mockResolvedValue({ id: 'access-id' }),
    });

    await expect(service.acceptInvitation(RECIPIENT_ID, TOKEN)).rejects.toBeInstanceOf(
      AccessAlreadyExistsError,
    );
    expect(mocks.grantProjectAccess).not.toHaveBeenCalled();
  });

  it('grants scan-level Viewer access through a scan share link', async () => {
    const { service, mocks } = createService({
      findByTokenHash: vi.fn().mockResolvedValue(null),
      findShareLinkByTokenHash: vi.fn().mockResolvedValue(scanShareLinkContext()),
    });

    const result = await service.acceptInvitation(RECIPIENT_ID, TOKEN);

    expect(result).toMatchObject({
      type: 'share-link',
      scope: 'scan',
      project: null,
      scan: { id: SCAN_ID, name: 'Living Room' },
      access: { role: 'VIEWER', status: 'ACTIVE', grantedAt: NOW.toISOString() },
    });
    expect(mocks.grantScanAccess).toHaveBeenCalledWith(
      SCAN_ID,
      RECIPIENT_ID,
      'c0ffee00-0000-4000-8000-0000000000aa',
      NOW,
    );
  });

  it('previews an active scan share link', async () => {
    const { service } = createService({
      findByTokenHash: vi.fn().mockResolvedValue(null),
      findShareLinkByTokenHash: vi.fn().mockResolvedValue(scanShareLinkContext()),
    });

    const result = await service.previewInvitation(TOKEN);

    expect(result).toMatchObject({
      type: 'share-link',
      scope: 'scan',
      project: null,
      scan: { id: SCAN_ID, name: 'Living Room' },
      status: 'ACTIVE',
    });
  });

  it('decline rejects a share-link token because share links cannot be declined', async () => {
    const { service } = createService({ findByTokenHash: vi.fn().mockResolvedValue(null) });

    await expect(service.declineInvitation(RECIPIENT_ID, TOKEN)).rejects.toBeInstanceOf(
      InvitationNotFoundError,
    );
  });
});

describe('ShareService.listScanShares', () => {
  it('lists pending scan invitations and scan viewers for the owner', async () => {
    const { service } = createService();

    const result = await service.listScanShares(OWNER_ID, SCAN_ID);

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

  it('rejects a non-owner', async () => {
    const { service } = createService({
      findScanInfo: vi.fn().mockResolvedValue({
        name: 'Living Room',
        projectId: PROJECT_ID,
        ownerId: OTHER_ID,
        ownerEmail: null,
      }),
    });

    await expect(service.listScanShares(OWNER_ID, SCAN_ID)).rejects.toBeInstanceOf(NotOwnerError);
  });

  it('rejects a missing scan', async () => {
    const { service } = createService({ findScanInfo: vi.fn().mockResolvedValue(null) });

    await expect(service.listScanShares(OWNER_ID, SCAN_ID)).rejects.toBeInstanceOf(
      ScanNotFoundError,
    );
  });
});

describe('ShareService.revokeScanViewer', () => {
  it('revokes scan Viewer access for the owner', async () => {
    const { service, mocks } = createService();

    const result = await service.revokeScanViewer(OWNER_ID, SCAN_ID, RECIPIENT_ID);

    expect(result).toEqual({
      scanId: SCAN_ID,
      userId: RECIPIENT_ID,
      revokedAt: NOW.toISOString(),
    });
    expect(mocks.revokeScanViewerAccess).toHaveBeenCalledWith(SCAN_ID, RECIPIENT_ID, NOW);
  });

  it('rejects a non-owner', async () => {
    const { service } = createService({
      findScanInfo: vi.fn().mockResolvedValue({
        name: 'Living Room',
        projectId: PROJECT_ID,
        ownerId: OTHER_ID,
        ownerEmail: null,
      }),
    });

    await expect(service.revokeScanViewer(OWNER_ID, SCAN_ID, RECIPIENT_ID)).rejects.toBeInstanceOf(
      NotOwnerError,
    );
  });

  it('rejects when no scan access record exists', async () => {
    const { service } = createService({
      revokeScanViewerAccess: vi.fn().mockResolvedValue(null),
    });

    await expect(service.revokeScanViewer(OWNER_ID, SCAN_ID, RECIPIENT_ID)).rejects.toBeInstanceOf(
      ViewerAccessNotFoundError,
    );
  });
});
