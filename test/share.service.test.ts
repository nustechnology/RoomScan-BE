import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import type { Mailer } from '../src/infrastructure/mail/mailer.types.js';
import { ProjectNotFoundError } from '../src/modules/project/project.errors.js';
import { ScanNotFoundError } from '../src/modules/scan/scan.errors.js';
import {
  AccessAlreadyExistsError,
  CannotAcceptOwnInvitationError,
  CannotInviteSelfError,
  InvitationAlreadyAcceptedError,
  InvitationAlreadySentError,
  InvitationDeclinedError,
  InvitationExpiredError,
  InvitationNotFoundError,
  InvitationNotForUserError,
  InvitationRevokedError,
  NotOwnerError,
  ProjectNotShareableError,
  RecipientUserNotFoundError,
  ScanNotShareableError,
  ShareLinkExpiredError,
  ShareNoLongerAvailableError,
  ViewerAccessNotFoundError,
} from '../src/modules/share/share.errors.js';
import { InvitationCreateResponseSchema } from '../src/modules/share/share.schemas.js';
import { ShareService } from '../src/modules/share/share.service.js';
import type {
  IdempotencyContext,
  IdempotencyGateway,
  IdempotencyResult,
} from '../src/common/idempotency/idempotency.types.js';
import type {
  InvitationCreateResult,
  InvitationRecord,
  ShareRecipientUser,
  ShareRepository,
} from '../src/modules/share/share.types.js';

const NOW = new Date('2026-07-29T10:00:00.000Z');
const OWNER_ID = 'eb5d278f-c857-45c7-887d-7be65288cb75';
const RECIPIENT_ID = 'f1a2b3c4-d5e6-7890-abcd-ef1234567890';
const OTHER_ID = '8c53d31d-2788-48de-82a0-c4f219ca3701';
const PROJECT_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const SCAN_ID = 'f1e2d3c4-a5b6-7890-abcd-ef1234567890';
const INVITATION_ID = 'b1a2c3d4-e5f6-4890-abcd-ef1234567890';
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abXYZ';
const RECIPIENT_EMAIL = 'recipient@example.com';
const RECIPIENT_PUBLIC_ID = 'GP5HS2WKBE';
const PAGE = { page: 1, limit: 20 };
const OTHER_PUBLIC_ID = 'DAYR3AXX2A';
const BASE_URL = 'https://invite.roomscan.dev';
const TTL = 7 * 24 * 60 * 60;
const RECIPIENT_USER = { id: RECIPIENT_ID, email: RECIPIENT_EMAIL };
const OWNER_USER = { id: OWNER_ID, email: 'owner@example.com' };

function invitationRecord(overrides: Partial<InvitationRecord> = {}): InvitationRecord {
  return {
    id: INVITATION_ID,
    projectId: PROJECT_ID,
    scanId: null,
    createdById: OWNER_ID,
    recipientEmail: RECIPIENT_EMAIL,
    recipientUserId: null,
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

function recipientUser(overrides: Partial<ShareRecipientUser> = {}): ShareRecipientUser {
  return {
    id: RECIPIENT_ID,
    publicUserId: RECIPIENT_PUBLIC_ID,
    email: RECIPIENT_EMAIL,
    displayName: null,
    ...overrides,
  };
}

/** An invitation bound to a recipient user rather than a typed-in email address. */
function userBoundInvitation(overrides: Partial<InvitationRecord> = {}) {
  return {
    ...invitationWithProject({
      recipientEmail: null,
      recipientUserId: RECIPIENT_ID,
      ...overrides,
    }),
    recipient: recipientUser(),
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
      owner: { id: OWNER_ID, email: 'owner@example.com', displayName: null },
      scanCount: 2,
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
    expirePendingInvitations: vi
      .fn<ShareRepository['expirePendingInvitations']>()
      .mockResolvedValue(0),
    findByTokenHash: vi
      .fn<ShareRepository['findByTokenHash']>()
      .mockResolvedValue(invitationWithProject()),
    findTokenSourceKindByTokenHash: vi
      .fn<ShareRepository['findTokenSourceKindByTokenHash']>()
      .mockResolvedValue(null),
    findUserByPublicId: vi
      .fn<ShareRepository['findUserByPublicId']>()
      .mockResolvedValue(recipientUser()),
    findUserById: vi.fn<ShareRepository['findUserById']>().mockResolvedValue(recipientUser()),
    findInvitationForRecipient: vi
      .fn<ShareRepository['findInvitationForRecipient']>()
      .mockResolvedValue(null),
    listReceivedInvitations: vi
      .fn<ShareRepository['listReceivedInvitations']>()
      .mockResolvedValue({ items: [], total: 0 }),
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
      .mockResolvedValue([{ invitation: invitationRecord(), recipient: null }]),
    findActiveViewerAccess: vi
      .fn<ShareRepository['findActiveViewerAccess']>()
      .mockResolvedValue(null),
    listActiveViewers: vi.fn<ShareRepository['listActiveViewers']>().mockResolvedValue([
      {
        userId: RECIPIENT_ID,
        revision: 1,
        user: { id: RECIPIENT_ID, email: RECIPIENT_EMAIL, displayName: null },
        grantedAt: NOW,
      },
    ]),
    revokeViewerAccess: vi
      .fn<ShareRepository['revokeViewerAccess']>()
      .mockResolvedValue({ revokedAt: NOW, revision: 2 }),
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
      .mockResolvedValue([{ invitation: invitationRecord(), recipient: null }]),
    findActiveScanAccess: vi.fn<ShareRepository['findActiveScanAccess']>().mockResolvedValue(null),
    listActiveScanViewers: vi.fn<ShareRepository['listActiveScanViewers']>().mockResolvedValue([
      {
        userId: RECIPIENT_ID,
        user: { id: RECIPIENT_ID, email: RECIPIENT_EMAIL, displayName: null },
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
          owner: { id: OWNER_ID, email: 'owner@example.com', displayName: null },
          scanCount: 2,
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

  it('binds the invitation to the user behind a public user id', async () => {
    const createInvitation = vi
      .fn()
      .mockResolvedValue(invitationRecord({ recipientEmail: null, recipientUserId: RECIPIENT_ID }));
    const { service, mocks, sendMail } = createService({ createInvitation });

    const result = await service.createInvitation(OWNER_ID, PROJECT_ID, {
      recipientPublicUserId: RECIPIENT_PUBLIC_ID,
    });

    expect(mocks.findUserByPublicId).toHaveBeenCalledWith(RECIPIENT_PUBLIC_ID);
    expect(createInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserId: RECIPIENT_ID }),
    );
    expect(result).toMatchObject({
      recipientEmail: null,
      recipientPublicUserId: RECIPIENT_PUBLIC_ID,
    });
    // Delivery still goes to whatever address the account has on file.
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: RECIPIENT_EMAIL }));
  });

  it('accepts a public user id in any case', async () => {
    const { service, mocks } = createService();

    await service.createInvitation(OWNER_ID, PROJECT_ID, {
      recipientPublicUserId: RECIPIENT_PUBLIC_ID.toLowerCase(),
    });

    expect(mocks.findUserByPublicId).toHaveBeenCalledWith(RECIPIENT_PUBLIC_ID);
  });

  it('skips email delivery when the invited user has no address on file', async () => {
    const { service, sendMail } = createService({
      findUserByPublicId: vi.fn().mockResolvedValue({
        id: RECIPIENT_ID,
        publicUserId: RECIPIENT_PUBLIC_ID,
        email: null,
        displayName: null,
      }),
    });

    await expect(
      service.createInvitation(OWNER_ID, PROJECT_ID, {
        recipientPublicUserId: RECIPIENT_PUBLIC_ID,
      }),
    ).resolves.toMatchObject({ status: 'PENDING' });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('rejects an unknown public user id', async () => {
    const { service, mocks } = createService({
      findUserByPublicId: vi.fn().mockResolvedValue(null),
    });

    await expect(
      service.createInvitation(OWNER_ID, PROJECT_ID, {
        recipientPublicUserId: OTHER_PUBLIC_ID,
      }),
    ).rejects.toBeInstanceOf(RecipientUserNotFoundError);
    expect(mocks.createInvitation).not.toHaveBeenCalled();
  });

  it('rejects a malformed public user id without hitting the database', async () => {
    const { service, mocks } = createService();

    await expect(
      service.createInvitation(OWNER_ID, PROJECT_ID, { recipientPublicUserId: 'not-an-id' }),
    ).rejects.toBeInstanceOf(RecipientUserNotFoundError);
    expect(mocks.findUserByPublicId).not.toHaveBeenCalled();
  });

  it('rejects an owner inviting themselves by public user id', async () => {
    const { service, mocks } = createService({
      findUserByPublicId: vi.fn().mockResolvedValue({
        id: OWNER_ID,
        publicUserId: OTHER_PUBLIC_ID,
        email: 'owner@example.com',
        displayName: null,
      }),
    });

    await expect(
      service.createInvitation(OWNER_ID, PROJECT_ID, {
        recipientPublicUserId: OTHER_PUBLIC_ID,
      }),
    ).rejects.toBeInstanceOf(CannotInviteSelfError);
    expect(mocks.createInvitation).not.toHaveBeenCalled();
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
  it('returns the safe project summary and recipient for an authenticated preview', async () => {
    const { service, mocks } = createService();

    const result = await service.previewInvitation(TOKEN, RECIPIENT_USER);

    expect(result).toEqual({
      type: 'invitation',
      scope: 'project',
      project: {
        id: PROJECT_ID,
        name: 'District 2 Apartment',
        description: null,
        thumbnail: null,
        owner: { id: OWNER_ID, email: 'owner@example.com', displayName: null },
        scanCount: 2,
      },
      scan: null,
      status: 'PENDING',
      recipientEmail: RECIPIENT_EMAIL,
      recipientPublicUserId: null,
      sentAt: NOW.toISOString(),
      expiresAt: new Date(NOW.getTime() + TTL * 1000).toISOString(),
      hasAccess: false,
    });
    expect(mocks.findByTokenHash).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f]{64}$/));
  });

  it('includes the recipient email for an authenticated preview', async () => {
    const { service } = createService();

    const result = await service.previewInvitation(TOKEN, RECIPIENT_USER);

    expect((result as { recipientEmail?: string }).recipientEmail).toBe(RECIPIENT_EMAIL);
  });

  it.each([
    ['EXPIRED', invitationWithProject({ expiresAt: new Date(NOW.getTime() - 1000) })],
    ['ACCEPTED', invitationWithProject({ status: 'ACCEPTED', acceptedAt: NOW })],
    ['DECLINED', invitationWithProject({ status: 'DECLINED', declinedAt: NOW })],
  ])('reports a %s status', async (status, invitation) => {
    const { service } = createService({
      findByTokenHash: vi.fn().mockResolvedValue(invitation),
    });

    const result = await service.previewInvitation(TOKEN, RECIPIENT_USER);

    expect(result.status).toBe(status);
  });

  it('throws ShareNoLongerAvailableError when previewing a revoked invitation', async () => {
    const { service } = createService({
      findByTokenHash: vi
        .fn()
        .mockResolvedValue(invitationWithProject({ status: 'REVOKED', revokedAt: NOW })),
    });

    await expect(service.previewInvitation(TOKEN, RECIPIENT_USER)).rejects.toBeInstanceOf(
      ShareNoLongerAvailableError,
    );
  });

  it('throws ShareNoLongerAvailableError when previewing an invitation whose source was deleted', async () => {
    const { service } = createService({
      findByTokenHash: vi.fn().mockResolvedValue(null),
      findShareLinkByTokenHash: vi.fn().mockResolvedValue(null),
      findTokenSourceKindByTokenHash: vi.fn().mockResolvedValue('invitation'),
    });

    await expect(service.previewInvitation(TOKEN, RECIPIENT_USER)).rejects.toBeInstanceOf(
      ShareNoLongerAvailableError,
    );
  });

  it('throws ShareNoLongerAvailableError when previewing a share link whose source was deleted', async () => {
    const { service } = createService({
      findByTokenHash: vi.fn().mockResolvedValue(null),
      findShareLinkByTokenHash: vi.fn().mockResolvedValue(null),
      findTokenSourceKindByTokenHash: vi.fn().mockResolvedValue('share-link'),
    });

    await expect(service.previewInvitation(TOKEN, RECIPIENT_USER)).rejects.toBeInstanceOf(
      ShareNoLongerAvailableError,
    );
  });

  it('rejects an unknown token with InvitationNotFoundError', async () => {
    const { service } = createService({
      findByTokenHash: vi.fn().mockResolvedValue(null),
      findShareLinkByTokenHash: vi.fn().mockResolvedValue(null),
    });

    await expect(service.previewInvitation(TOKEN, RECIPIENT_USER)).rejects.toBeInstanceOf(
      InvitationNotFoundError,
    );
  });

  it('reports hasAccess for an authenticated user with active access', async () => {
    const { service } = createService({
      findActiveViewerAccess: vi.fn().mockResolvedValue({ id: 'access-id' }),
    });

    const result = await service.previewInvitation(TOKEN, {
      id: RECIPIENT_ID,
      email: RECIPIENT_EMAIL,
    });

    expect(result.hasAccess).toBe(true);
  });

  it('reports hasAccess false for an authenticated user without access', async () => {
    const { service } = createService();

    const result = await service.previewInvitation(TOKEN, {
      id: RECIPIENT_ID,
      email: RECIPIENT_EMAIL,
    });

    expect(result.hasAccess).toBe(false);
  });

  it('previews an email invitation for any signed-in holder of the link', async () => {
    const { service } = createService();

    await expect(
      service.previewInvitation(TOKEN, {
        id: RECIPIENT_ID,
        email: 'someone-else@example.com',
      }),
    ).resolves.toMatchObject({ type: 'invitation', status: 'PENDING' });
  });

  it('previews an email invitation when the current user has no email on file', async () => {
    const { service } = createService();

    await expect(
      service.previewInvitation(TOKEN, { id: RECIPIENT_ID, email: null }),
    ).resolves.toMatchObject({ type: 'invitation', status: 'PENDING' });
  });

  it('reports the recipient public user id for a user-bound invitation', async () => {
    const { service } = createService({
      findByTokenHash: vi.fn().mockResolvedValue(userBoundInvitation()),
    });

    await expect(service.previewInvitation(TOKEN, RECIPIENT_USER)).resolves.toMatchObject({
      recipientEmail: null,
      recipientPublicUserId: RECIPIENT_PUBLIC_ID,
    });
  });

  it('rejects previewing a user-bound invitation addressed to somebody else', async () => {
    const { service } = createService({
      findByTokenHash: vi.fn().mockResolvedValue(userBoundInvitation()),
    });

    await expect(
      service.previewInvitation(TOKEN, { id: OTHER_ID, email: RECIPIENT_EMAIL }),
    ).rejects.toBeInstanceOf(InvitationNotForUserError);
  });

  it('resolves an invitation id for the user it is addressed to', async () => {
    const context = userBoundInvitation();
    const findInvitationForRecipient = vi.fn().mockResolvedValue(context);
    const { service, mocks } = createService({ findInvitationForRecipient });

    await expect(service.previewInvitation(INVITATION_ID, RECIPIENT_USER)).resolves.toMatchObject({
      type: 'invitation',
    });
    expect(findInvitationForRecipient).toHaveBeenCalledWith(INVITATION_ID, RECIPIENT_ID);
    expect(mocks.findByTokenHash).not.toHaveBeenCalled();
  });

  it('rejects an invitation id that is not addressed to the current user', async () => {
    const { service } = createService({
      findInvitationForRecipient: vi.fn().mockResolvedValue(null),
    });

    await expect(
      service.previewInvitation(INVITATION_ID, { id: OTHER_ID, email: null }),
    ).rejects.toBeInstanceOf(InvitationNotFoundError);
  });

  it('rejects a share-link preview only on recipient rules; matching user succeeds', async () => {
    const { service } = createService({ findByTokenHash: vi.fn().mockResolvedValue(null) });

    await expect(service.previewInvitation(TOKEN, RECIPIENT_USER)).resolves.toMatchObject({
      type: 'share-link',
      scope: 'project',
    });
  });
});

describe('ShareService.listReceivedInvitations', () => {
  it('maps the invitations addressed to the current user', async () => {
    const listReceivedInvitations = vi.fn().mockResolvedValue({
      items: [
        {
          ...userBoundInvitation(),
          creator: { id: OWNER_ID, email: 'owner@example.com', displayName: 'Owner' },
        },
      ],
      total: 1,
    });
    const { service } = createService({ listReceivedInvitations });

    const result = await service.listReceivedInvitations(RECIPIENT_ID, PAGE);

    expect(listReceivedInvitations).toHaveBeenCalledWith(RECIPIENT_ID, PAGE);
    expect(result.pagination).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
    expect(result.items).toEqual([
      {
        invitationId: INVITATION_ID,
        scope: 'project',
        project: {
          id: PROJECT_ID,
          name: 'District 2 Apartment',
          description: null,
          thumbnail: null,
          owner: { id: OWNER_ID, email: 'owner@example.com', displayName: null },
          scanCount: 2,
        },
        scan: null,
        status: 'PENDING',
        invitedBy: { id: OWNER_ID, email: 'owner@example.com', displayName: 'Owner' },
        sentAt: NOW.toISOString(),
        expiresAt: new Date(NOW.getTime() + TTL * 1000).toISOString(),
      },
    ]);
  });

  it('returns an empty list when nothing is addressed to the user', async () => {
    const { service } = createService();

    await expect(service.listReceivedInvitations(OTHER_ID, PAGE)).resolves.toEqual({
      items: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });
  });

  it('passes the requested page through to the repository', async () => {
    const listReceivedInvitations = vi.fn().mockResolvedValue({ items: [], total: 45 });
    const { service } = createService({ listReceivedInvitations });

    const result = await service.listReceivedInvitations(RECIPIENT_ID, { page: 3, limit: 20 });

    expect(listReceivedInvitations).toHaveBeenCalledWith(RECIPIENT_ID, { page: 3, limit: 20 });
    expect(result.pagination).toEqual({ page: 3, limit: 20, total: 45, totalPages: 3 });
  });
});

describe('ShareService.acceptInvitation', () => {
  it('grants active Viewer access and returns the shared project summary', async () => {
    const { service, mocks } = createService();

    const result = await service.acceptInvitation(RECIPIENT_USER, TOKEN);

    expect(result).toEqual({
      type: 'invitation',
      invitationId: INVITATION_ID,
      scope: 'project',
      project: {
        id: PROJECT_ID,
        name: 'District 2 Apartment',
        description: null,
        thumbnail: null,
        owner: { id: OWNER_ID, email: 'owner@example.com', displayName: null },
        scanCount: 2,
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

  it('accepts an email invitation for any signed-in holder of the link', async () => {
    const { service, mocks } = createService();

    await expect(
      service.acceptInvitation({ id: RECIPIENT_ID, email: 'someone-else@example.com' }, TOKEN),
    ).resolves.toMatchObject({ type: 'invitation' });
    expect(mocks.acceptInvitation).toHaveBeenCalled();
  });

  it('accepts a user-bound invitation for the user it names', async () => {
    const { service, mocks } = createService({
      findByTokenHash: vi.fn().mockResolvedValue(userBoundInvitation()),
    });

    await expect(service.acceptInvitation(RECIPIENT_USER, TOKEN)).resolves.toMatchObject({
      type: 'invitation',
    });
    expect(mocks.acceptInvitation).toHaveBeenCalled();
  });

  it('rejects accepting a user-bound invitation addressed to somebody else', async () => {
    const { service, mocks } = createService({
      findByTokenHash: vi.fn().mockResolvedValue(userBoundInvitation()),
    });

    await expect(
      service.acceptInvitation({ id: OTHER_ID, email: RECIPIENT_EMAIL }, TOKEN),
    ).rejects.toBeInstanceOf(InvitationNotForUserError);
    expect(mocks.acceptInvitation).not.toHaveBeenCalled();
  });

  it.each([
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

    await expect(service.acceptInvitation(RECIPIENT_USER, TOKEN)).rejects.toBeInstanceOf(
      errorClass,
    );
    expect(mocks.acceptInvitation).not.toHaveBeenCalled();
  });

  it('rejects a revoked invitation with ShareNoLongerAvailableError', async () => {
    const { service, mocks } = createService({
      findByTokenHash: vi
        .fn()
        .mockResolvedValue(invitationWithProject({ status: 'REVOKED', revokedAt: NOW })),
    });

    await expect(service.acceptInvitation(RECIPIENT_USER, TOKEN)).rejects.toBeInstanceOf(
      ShareNoLongerAvailableError,
    );
    expect(mocks.acceptInvitation).not.toHaveBeenCalled();
  });

  it('rejects accepting an invitation whose source was deleted', async () => {
    const { service, mocks } = createService({
      findByTokenHash: vi.fn().mockResolvedValue(null),
      findShareLinkByTokenHash: vi.fn().mockResolvedValue(null),
      findTokenSourceKindByTokenHash: vi.fn().mockResolvedValue('invitation'),
    });

    await expect(service.acceptInvitation(RECIPIENT_USER, TOKEN)).rejects.toBeInstanceOf(
      ShareNoLongerAvailableError,
    );
    expect(mocks.acceptInvitation).not.toHaveBeenCalled();
  });

  it('rejects an unknown token', async () => {
    const { service } = createService({
      findByTokenHash: vi.fn().mockResolvedValue(null),
      findShareLinkByTokenHash: vi.fn().mockResolvedValue(null),
    });

    await expect(service.acceptInvitation(RECIPIENT_USER, TOKEN)).rejects.toBeInstanceOf(
      InvitationNotFoundError,
    );
  });

  it('rejects the project owner accepting their own invitation', async () => {
    const { service, mocks } = createService();

    await expect(service.acceptInvitation(OWNER_USER, TOKEN)).rejects.toBeInstanceOf(
      CannotAcceptOwnInvitationError,
    );
    expect(mocks.acceptInvitation).not.toHaveBeenCalled();
  });

  it('rejects a user that already has active access', async () => {
    const { service, mocks } = createService({
      findActiveViewerAccess: vi.fn().mockResolvedValue({ id: 'access-id' }),
    });

    await expect(service.acceptInvitation(RECIPIENT_USER, TOKEN)).rejects.toBeInstanceOf(
      AccessAlreadyExistsError,
    );
    expect(mocks.acceptInvitation).not.toHaveBeenCalled();
  });

  it('rejects when the acceptance race is lost', async () => {
    const { service } = createService({
      acceptInvitation: vi.fn().mockResolvedValue(null),
    });

    await expect(service.acceptInvitation(RECIPIENT_USER, TOKEN)).rejects.toBeInstanceOf(
      InvitationAlreadyAcceptedError,
    );
  });
});

describe('ShareService.declineInvitation', () => {
  it('records the decline and returns the updated status', async () => {
    const { service, mocks } = createService();

    const result = await service.declineInvitation(RECIPIENT_USER, TOKEN);

    expect(result).toEqual({
      invitationId: INVITATION_ID,
      status: 'DECLINED',
      declinedAt: NOW.toISOString(),
    });
    expect(mocks.declineInvitation).toHaveBeenCalledWith(INVITATION_ID, NOW);
  });

  it('declines an email invitation for any signed-in holder of the link', async () => {
    const { service, mocks } = createService();

    await expect(
      service.declineInvitation({ id: RECIPIENT_ID, email: 'someone-else@example.com' }, TOKEN),
    ).resolves.toMatchObject({ status: 'DECLINED' });
    expect(mocks.declineInvitation).toHaveBeenCalled();
  });

  it('rejects declining a user-bound invitation addressed to somebody else', async () => {
    const { service, mocks } = createService({
      findByTokenHash: vi.fn().mockResolvedValue(userBoundInvitation()),
    });

    await expect(
      service.declineInvitation({ id: OTHER_ID, email: RECIPIENT_EMAIL }, TOKEN),
    ).rejects.toBeInstanceOf(InvitationNotForUserError);
    expect(mocks.declineInvitation).not.toHaveBeenCalled();
  });

  it('rejects a user that already has active access', async () => {
    const { service, mocks } = createService({
      findActiveViewerAccess: vi.fn().mockResolvedValue({ id: 'access-id' }),
    });

    await expect(service.declineInvitation(RECIPIENT_USER, TOKEN)).rejects.toBeInstanceOf(
      AccessAlreadyExistsError,
    );
    expect(mocks.declineInvitation).not.toHaveBeenCalled();
  });

  it('rejects declining a revoked invitation with ShareNoLongerAvailableError', async () => {
    const { service, mocks } = createService({
      findByTokenHash: vi
        .fn()
        .mockResolvedValue(invitationWithProject({ status: 'REVOKED', revokedAt: NOW })),
    });

    await expect(service.declineInvitation(RECIPIENT_USER, TOKEN)).rejects.toBeInstanceOf(
      ShareNoLongerAvailableError,
    );
    expect(mocks.declineInvitation).not.toHaveBeenCalled();
  });

  it('rejects declining an invitation whose source was deleted', async () => {
    const { service, mocks } = createService({
      findByTokenHash: vi.fn().mockResolvedValue(null),
      findTokenSourceKindByTokenHash: vi.fn().mockResolvedValue('invitation'),
    });

    await expect(service.declineInvitation(RECIPIENT_USER, TOKEN)).rejects.toBeInstanceOf(
      ShareNoLongerAvailableError,
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
  ])('rejects revoking an invitation that is %s', async (_label, record, errorClass) => {
    const { service } = createService({
      findInvitationById: vi.fn().mockResolvedValue(record),
    });

    await expect(service.revokeInvitation(OWNER_ID, INVITATION_ID)).rejects.toBeInstanceOf(
      errorClass,
    );
  });

  it('revokes an invitation that has expired so the owner can clean up stale links', async () => {
    const { service, mocks } = createService({
      findInvitationById: vi
        .fn()
        .mockResolvedValue(invitationRecord({ expiresAt: new Date(NOW.getTime() - 1) })),
    });

    const result = await service.revokeInvitation(OWNER_ID, INVITATION_ID);

    expect(result).toEqual({
      invitationId: INVITATION_ID,
      status: 'REVOKED',
      revokedAt: NOW.toISOString(),
    });
    expect(mocks.revokeInvitation).toHaveBeenCalledWith(INVITATION_ID, NOW);
  });
});

describe('ShareService.resendInvitation', () => {
  it('re-sends a user-bound invitation to the address on file today', async () => {
    const findUserById = vi.fn().mockResolvedValue({
      id: RECIPIENT_ID,
      publicUserId: RECIPIENT_PUBLIC_ID,
      email: 'moved@example.com',
      displayName: null,
    });
    const { service, sendMail } = createService({
      findInvitationById: vi
        .fn()
        .mockResolvedValue(
          invitationRecord({ recipientEmail: null, recipientUserId: RECIPIENT_ID }),
        ),
      resendInvitation: vi
        .fn()
        .mockResolvedValue(
          invitationRecord({ recipientEmail: null, recipientUserId: RECIPIENT_ID }),
        ),
      findUserById,
    });

    const result = await service.resendInvitation(OWNER_ID, INVITATION_ID);

    expect(findUserById).toHaveBeenCalledWith(RECIPIENT_ID);
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'moved@example.com' }));
    expect(result).toMatchObject({
      recipientEmail: null,
      recipientPublicUserId: RECIPIENT_PUBLIC_ID,
    });
  });

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
      ScanNotFoundError,
    );
  });
});

describe('ShareService.createInvitationIdempotently', () => {
  function createIdempotentService(
    lookupResult: unknown,
    overrides: Partial<ShareRepository> = {},
  ) {
    const { mocks } = createService(overrides);
    const lookup = vi.fn<(context: IdempotencyContext) => Promise<unknown>>();
    lookup.mockResolvedValue(lookupResult);
    const idempotency: IdempotencyGateway = {
      createContext: vi.fn<IdempotencyGateway['createContext']>().mockReturnValue({
        userId: OWNER_ID,
        operation: 'CREATE_INVITATION',
        parentScope: `project:${PROJECT_ID}`,
        keyHash: 'k'.repeat(64),
        requestHash: 'r'.repeat(64),
      }),
      // A receipt's stored body is untyped until the caller names its shape, so
      // the cast happens here rather than being pushed onto the whole gateway.
      async lookup<T>(context: IdempotencyContext) {
        return (await lookup(context)) as IdempotencyResult<T> | null;
      },
    };
    const createIdempotently = vi
      .fn()
      .mockResolvedValue({ body: {}, statusCode: 201, replayed: false });
    const repository = {
      ...mocks,
      ...overrides,
      createInvitationIdempotently: createIdempotently,
    } as unknown as ShareRepository;
    const service = new ShareService({
      repository,
      mailer: { sendMail: vi.fn() },
      logger: pino({ enabled: false }),
      clock: () => NOW,
      invitationTtlSeconds: TTL,
      invitationBaseUrl: BASE_URL,
      idempotency,
    });

    return { service, lookup, createIdempotently };
  }

  it('fills in the recipient fields when replaying a receipt stored without them', async () => {
    // A receipt written before invitations became addressable by public user id.
    const { service } = createIdempotentService({
      body: {
        invitationId: INVITATION_ID,
        invitationUrl: `${BASE_URL}/invitations/${TOKEN}`,
        recipientEmail: RECIPIENT_EMAIL,
        expiresAt: NOW.toISOString(),
        status: 'PENDING',
        sentAt: NOW.toISOString(),
      },
      statusCode: 201,
      replayed: true,
    });

    const result = await service.createInvitationIdempotently(
      OWNER_ID,
      PROJECT_ID,
      { recipientEmail: RECIPIENT_EMAIL },
      'idempotency-key',
    );

    expect(result.replayed).toBe(true);
    expect(result.statusCode).toBe(201);
    expect(result.body).toMatchObject({
      recipientEmail: RECIPIENT_EMAIL,
      recipientPublicUserId: null,
    });
    // The route parses every response, replayed or not: a legacy body must still
    // satisfy the contract, otherwise the retry answers 400 instead of 201.
    expect(() => InvitationCreateResponseSchema.parse(result.body)).not.toThrow();
  });

  it('builds the same scoped invitationUrl as the non-idempotent path', async () => {
    const { service, createIdempotently } = createIdempotentService(null);

    await service.createInvitationIdempotently(
      OWNER_ID,
      PROJECT_ID,
      { recipientEmail: RECIPIENT_EMAIL },
      'idempotency-key',
    );

    // The mobile universal-link parser reads ?scope= to know what the link
    // targets before it previews the token, so both creation paths must emit it.
    const storedResponse = createIdempotently.mock.calls[0]?.[2] as InvitationCreateResult;
    expect(storedResponse.invitationUrl).toMatch(
      new RegExp(`^${BASE_URL}/invitations/[A-Za-z0-9_-]{43}\\?scope=project$`),
    );
  });

  it('replays a current receipt unchanged', async () => {
    const body = {
      invitationId: INVITATION_ID,
      invitationUrl: `${BASE_URL}/invitations/${TOKEN}`,
      recipientEmail: null,
      recipientPublicUserId: RECIPIENT_PUBLIC_ID,
      expiresAt: NOW.toISOString(),
      status: 'PENDING' as const,
      sentAt: NOW.toISOString(),
    };
    const { service, createIdempotently } = createIdempotentService({
      body,
      statusCode: 201,
      replayed: true,
    });

    const result = await service.createInvitationIdempotently(
      OWNER_ID,
      PROJECT_ID,
      { recipientPublicUserId: RECIPIENT_PUBLIC_ID },
      'idempotency-key',
    );

    expect(result.body).toEqual(body);
    expect(createIdempotently).not.toHaveBeenCalled();
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
          recipientPublicUserId: null,
          recipientDisplayName: null,
          status: 'PENDING',
          sentAt: NOW.toISOString(),
          expiresAt: new Date(NOW.getTime() + TTL * 1000).toISOString(),
        },
      ],
      viewers: [
        {
          userId: RECIPIENT_ID,
          revision: 1,
          recipientUser: { id: RECIPIENT_ID, email: RECIPIENT_EMAIL, displayName: null },
          grantedAt: NOW.toISOString(),
        },
      ],
    });
  });

  it('labels an expired pending invitation as EXPIRED', async () => {
    const { service } = createService({
      listPendingByProject: vi.fn().mockResolvedValue([
        {
          invitation: invitationRecord({ expiresAt: new Date(NOW.getTime() - 1) }),
          recipient: null,
        },
      ]),
    });

    const result = await service.listShares(OWNER_ID, PROJECT_ID);

    expect(result.pendingInvitations[0]?.status).toBe('EXPIRED');
  });

  it('reports the recipient public id and display name for a user-bound invitation', async () => {
    const { service } = createService({
      listPendingByProject: vi.fn().mockResolvedValue([
        {
          invitation: invitationRecord({ recipientEmail: null, recipientUserId: RECIPIENT_ID }),
          recipient: recipientUser({ displayName: 'Tham Tran' }),
        },
      ]),
    });

    const result = await service.listShares(OWNER_ID, PROJECT_ID);

    expect(result.pendingInvitations[0]).toMatchObject({
      recipientEmail: null,
      recipientPublicUserId: RECIPIENT_PUBLIC_ID,
      recipientDisplayName: 'Tham Tran',
    });
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
      revision: 2,
      revokedAt: NOW.toISOString(),
    });
    expect(mocks.revokeViewerAccess).toHaveBeenCalledWith(PROJECT_ID, RECIPIENT_ID, NOW);
  });

  it('returns the existing revokedAt when access was already revoked', async () => {
    const { service } = createService({
      revokeViewerAccess: vi.fn().mockResolvedValue({ revokedAt: NOW, revision: 2 }),
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
      noteCount: 5,
      creator: { id: OWNER_ID, email: 'owner@example.com', displayName: null },
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
      owner: { id: OWNER_ID, email: 'owner@example.com', displayName: null },
      scanCount: 2,
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
      noteCount: 5,
      creator: { id: OWNER_ID, email: 'owner@example.com', displayName: null },
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

    const result = await service.previewInvitation(TOKEN, RECIPIENT_USER);

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

    const result = await service.previewInvitation(TOKEN, RECIPIENT_USER);

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

    const result = await service.previewInvitation(TOKEN, {
      id: RECIPIENT_ID,
      email: RECIPIENT_EMAIL,
    });

    expect((result as { hasAccess?: boolean }).hasAccess).toBe(true);
  });

  it('throws ShareNoLongerAvailableError for a revoked share link', async () => {
    const { service } = createService({
      findByTokenHash: vi.fn().mockResolvedValue(null),
      findShareLinkByTokenHash: vi.fn().mockResolvedValue({
        ...shareLinkContext(),
        shareLink: { ...shareLinkContext().shareLink, revokedAt: NOW },
      }),
    });

    await expect(service.previewInvitation(TOKEN, RECIPIENT_USER)).rejects.toBeInstanceOf(
      ShareNoLongerAvailableError,
    );
  });
});

describe('ShareService.acceptInvitation scan and share-link scopes', () => {
  it('grants scan-level Viewer access for a scan-scope invitation', async () => {
    const { service, mocks } = createService({
      findByTokenHash: vi.fn().mockResolvedValue(scanInvitationContext()),
    });

    const result = await service.acceptInvitation(RECIPIENT_USER, TOKEN);

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

    await expect(service.acceptInvitation(OWNER_USER, TOKEN)).rejects.toBeInstanceOf(
      CannotAcceptOwnInvitationError,
    );
    expect(mocks.acceptScanInvitation).not.toHaveBeenCalled();
  });

  it('rejects a scan invitation for a user that already has scan access', async () => {
    const { service, mocks } = createService({
      findByTokenHash: vi.fn().mockResolvedValue(scanInvitationContext()),
      findActiveScanAccess: vi.fn().mockResolvedValue({ id: 'access-id' }),
    });

    await expect(service.acceptInvitation(RECIPIENT_USER, TOKEN)).rejects.toBeInstanceOf(
      AccessAlreadyExistsError,
    );
    expect(mocks.acceptScanInvitation).not.toHaveBeenCalled();
  });

  it('grants Viewer access through a project share link', async () => {
    const { service, mocks } = createService({ findByTokenHash: vi.fn().mockResolvedValue(null) });

    const result = await service.acceptInvitation(RECIPIENT_USER, TOKEN);

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

    await expect(service.acceptInvitation(RECIPIENT_USER, TOKEN)).rejects.toBeInstanceOf(
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

    await expect(service.acceptInvitation(RECIPIENT_USER, TOKEN)).rejects.toBeInstanceOf(
      ShareNoLongerAvailableError,
    );
    expect(mocks.grantProjectAccess).not.toHaveBeenCalled();
  });

  it('rejects the project owner accepting their own share link', async () => {
    const { service, mocks } = createService({ findByTokenHash: vi.fn().mockResolvedValue(null) });

    await expect(service.acceptInvitation(OWNER_USER, TOKEN)).rejects.toBeInstanceOf(
      CannotAcceptOwnInvitationError,
    );
    expect(mocks.grantProjectAccess).not.toHaveBeenCalled();
  });

  it('rejects a share link for a user that already has active access', async () => {
    const { service, mocks } = createService({
      findByTokenHash: vi.fn().mockResolvedValue(null),
      findActiveViewerAccess: vi.fn().mockResolvedValue({ id: 'access-id' }),
    });

    await expect(service.acceptInvitation(RECIPIENT_USER, TOKEN)).rejects.toBeInstanceOf(
      AccessAlreadyExistsError,
    );
    expect(mocks.grantProjectAccess).not.toHaveBeenCalled();
  });

  it('grants scan-level Viewer access through a scan share link', async () => {
    const { service, mocks } = createService({
      findByTokenHash: vi.fn().mockResolvedValue(null),
      findShareLinkByTokenHash: vi.fn().mockResolvedValue(scanShareLinkContext()),
    });

    const result = await service.acceptInvitation(RECIPIENT_USER, TOKEN);

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

    const result = await service.previewInvitation(TOKEN, RECIPIENT_USER);

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

    await expect(service.declineInvitation(RECIPIENT_USER, TOKEN)).rejects.toBeInstanceOf(
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
          recipientPublicUserId: null,
          recipientDisplayName: null,
          status: 'PENDING',
          sentAt: NOW.toISOString(),
          expiresAt: new Date(NOW.getTime() + TTL * 1000).toISOString(),
        },
      ],
      viewers: [
        {
          userId: RECIPIENT_ID,
          recipientUser: { id: RECIPIENT_ID, email: RECIPIENT_EMAIL, displayName: null },
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

describe('ShareService branch coverage', () => {
  it('falls back to a generic owner display when the project owner email is missing', async () => {
    const { service, sendMail } = createService({
      findProjectInfo: vi.fn().mockResolvedValue({
        name: 'District 2 Apartment',
        ownerId: OWNER_ID,
        ownerEmail: null,
      }),
    });

    const result = await service.createInvitation(OWNER_ID, PROJECT_ID, {
      recipientEmail: RECIPIENT_EMAIL,
    });

    expect(result.status).toBe('PENDING');
    const message = sendMail.mock.calls[0]?.[0];
    expect(message?.subject).toContain('the project owner');
  });

  it('falls back to a generic scan-owner display when the owner email is missing', async () => {
    const { service, sendMail } = createService({
      findScanInfo: vi.fn().mockResolvedValue({
        name: 'Living Room',
        projectId: PROJECT_ID,
        ownerId: OWNER_ID,
        ownerEmail: null,
      }),
    });

    const result = await service.createScanInvitation(OWNER_ID, SCAN_ID, {
      recipientEmail: RECIPIENT_EMAIL,
    });

    expect(result.status).toBe('PENDING');
    const message = sendMail.mock.calls[0]?.[0];
    expect(message?.subject).toContain('the scan owner');
  });

  it('still creates a scan invitation when the email fails to send', async () => {
    const { service, sendMail } = createService();
    sendMail.mockRejectedValueOnce(new Error('smtp unavailable'));

    await expect(
      service.createScanInvitation(OWNER_ID, SCAN_ID, { recipientEmail: RECIPIENT_EMAIL }),
    ).resolves.toEqual(expect.objectContaining({ status: 'PENDING' }));
  });

  it('reports hasAccess for an authenticated scan-scope preview', async () => {
    const { service } = createService({
      findByTokenHash: vi.fn().mockResolvedValue(scanInvitationContext()),
      findActiveScanAccess: vi.fn().mockResolvedValue({ id: 'access-id' }),
    });

    const result = await service.previewInvitation(TOKEN, RECIPIENT_USER);

    expect((result as { hasAccess?: boolean }).hasAccess).toBe(true);
  });

  it('reports hasAccess false for an authenticated scan-scope preview without access', async () => {
    const { service } = createService({
      findByTokenHash: vi.fn().mockResolvedValue(scanInvitationContext()),
    });

    const result = await service.previewInvitation(TOKEN, RECIPIENT_USER);

    expect((result as { hasAccess?: boolean }).hasAccess).toBe(false);
  });

  it('reports hasAccess for a scan share link', async () => {
    const { service } = createService({
      findByTokenHash: vi.fn().mockResolvedValue(null),
      findShareLinkByTokenHash: vi.fn().mockResolvedValue(scanShareLinkContext()),
      findActiveScanAccess: vi.fn().mockResolvedValue({ id: 'access-id' }),
    });

    const result = await service.previewInvitation(TOKEN, RECIPIENT_USER);

    expect((result as { hasAccess?: boolean }).hasAccess).toBe(true);
  });

  it.each([
    [
      'revoked',
      scanInvitationContext({ status: 'REVOKED', revokedAt: NOW }),
      ShareNoLongerAvailableError,
    ],
    [
      'accepted',
      scanInvitationContext({ status: 'ACCEPTED', acceptedAt: NOW }),
      InvitationAlreadyAcceptedError,
    ],
    [
      'declined',
      scanInvitationContext({ status: 'DECLINED', declinedAt: NOW }),
      InvitationDeclinedError,
    ],
    [
      'expired',
      scanInvitationContext({ expiresAt: new Date(NOW.getTime() - 1) }),
      InvitationExpiredError,
    ],
  ])('rejects accepting a scan invitation that is %s', async (_label, invitation, errorClass) => {
    const { service, mocks } = createService({
      findByTokenHash: vi.fn().mockResolvedValue(invitation),
    });

    await expect(service.acceptInvitation(RECIPIENT_USER, TOKEN)).rejects.toBeInstanceOf(
      errorClass,
    );
    expect(mocks.acceptScanInvitation).not.toHaveBeenCalled();
  });

  it('rejects a scan invitation when the acceptance race is lost', async () => {
    const { service } = createService({
      findByTokenHash: vi.fn().mockResolvedValue(scanInvitationContext()),
      acceptScanInvitation: vi.fn().mockResolvedValue(null),
    });

    await expect(service.acceptInvitation(RECIPIENT_USER, TOKEN)).rejects.toBeInstanceOf(
      InvitationAlreadyAcceptedError,
    );
  });

  it('rejects declining an unknown token', async () => {
    const { service } = createService({
      findByTokenHash: vi.fn().mockResolvedValue(null),
    });

    await expect(service.declineInvitation(RECIPIENT_USER, TOKEN)).rejects.toBeInstanceOf(
      InvitationNotFoundError,
    );
  });

  it('records a decline for a scan-scope invitation', async () => {
    const { service, mocks } = createService({
      findByTokenHash: vi.fn().mockResolvedValue(scanInvitationContext()),
    });

    const result = await service.declineInvitation(RECIPIENT_USER, TOKEN);

    expect(result).toEqual({
      invitationId: INVITATION_ID,
      status: 'DECLINED',
      declinedAt: NOW.toISOString(),
    });
    expect(mocks.declineInvitation).toHaveBeenCalledWith(INVITATION_ID, NOW);
  });

  it.each([
    [
      'revoked',
      invitationWithProject({ status: 'REVOKED', revokedAt: NOW }),
      ShareNoLongerAvailableError,
    ],
    [
      'accepted',
      invitationWithProject({ status: 'ACCEPTED', acceptedAt: NOW }),
      InvitationAlreadyAcceptedError,
    ],
    [
      'declined',
      invitationWithProject({ status: 'DECLINED', declinedAt: NOW }),
      InvitationDeclinedError,
    ],
    [
      'expired',
      invitationWithProject({ expiresAt: new Date(NOW.getTime() - 1) }),
      InvitationExpiredError,
    ],
  ])('rejects declining an invitation that is %s', async (_label, invitation, errorClass) => {
    const { service, mocks } = createService({
      findByTokenHash: vi.fn().mockResolvedValue(invitation),
    });

    await expect(service.declineInvitation(RECIPIENT_USER, TOKEN)).rejects.toBeInstanceOf(
      errorClass,
    );
    expect(mocks.declineInvitation).not.toHaveBeenCalled();
  });

  it('rejects the owner declining their own invitation', async () => {
    const { service, mocks } = createService();

    await expect(service.declineInvitation(OWNER_USER, TOKEN)).rejects.toBeInstanceOf(
      CannotAcceptOwnInvitationError,
    );
    expect(mocks.declineInvitation).not.toHaveBeenCalled();
  });

  it('rejects when the decline race is lost', async () => {
    const { service } = createService({
      declineInvitation: vi.fn().mockResolvedValue(null),
    });

    await expect(service.declineInvitation(RECIPIENT_USER, TOKEN)).rejects.toBeInstanceOf(
      InvitationDeclinedError,
    );
  });

  it('revokes a scan-scope invitation as the scan owner', async () => {
    const { service, mocks } = createService({
      findInvitationById: vi
        .fn()
        .mockResolvedValue(invitationRecord({ projectId: null, scanId: SCAN_ID })),
    });

    const result = await service.revokeInvitation(OWNER_ID, INVITATION_ID);

    expect(result).toEqual(
      expect.objectContaining({ invitationId: INVITATION_ID, status: 'REVOKED' }),
    );
    expect(mocks.revokeInvitation).toHaveBeenCalled();
  });

  it('rejects revoking a scan invitation by a non-owner', async () => {
    const { service } = createService({
      findInvitationById: vi
        .fn()
        .mockResolvedValue(invitationRecord({ projectId: null, scanId: SCAN_ID })),
      findScanInfo: vi.fn().mockResolvedValue({
        name: 'Living Room',
        projectId: PROJECT_ID,
        ownerId: OTHER_ID,
        ownerEmail: null,
      }),
    });

    await expect(service.revokeInvitation(OWNER_ID, INVITATION_ID)).rejects.toBeInstanceOf(
      NotOwnerError,
    );
  });

  it('rejects revoking an invitation whose scan is missing', async () => {
    const { service } = createService({
      findInvitationById: vi
        .fn()
        .mockResolvedValue(invitationRecord({ projectId: null, scanId: SCAN_ID })),
      findScanInfo: vi.fn().mockResolvedValue(null),
    });

    await expect(service.revokeInvitation(OWNER_ID, INVITATION_ID)).rejects.toBeInstanceOf(
      InvitationNotFoundError,
    );
  });

  it('rejects revoking an invitation with neither project nor scan scope', async () => {
    const { service } = createService({
      findInvitationById: vi
        .fn()
        .mockResolvedValue(invitationRecord({ projectId: null, scanId: null })),
    });

    await expect(service.revokeInvitation(OWNER_ID, INVITATION_ID)).rejects.toBeInstanceOf(
      InvitationNotFoundError,
    );
  });

  it('rejects revoking when the revoke write returns null', async () => {
    const { service } = createService({
      revokeInvitation: vi.fn().mockResolvedValue(null),
    });

    await expect(service.revokeInvitation(OWNER_ID, INVITATION_ID)).rejects.toBeInstanceOf(
      InvitationNotFoundError,
    );
  });

  it('rejects resending when the resend write returns null', async () => {
    const { service } = createService({
      resendInvitation: vi.fn().mockResolvedValue(null),
    });

    await expect(service.resendInvitation(OWNER_ID, INVITATION_ID)).rejects.toBeInstanceOf(
      InvitationNotFoundError,
    );
  });
});
