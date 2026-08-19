import { SignJWT, jwtVerify } from 'jose';
import pino from 'pino';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import type {
  AccessTokenVerifier,
  CurrentUserRepository,
} from '../src/common/middleware/authenticate.js';
import { createRateLimiters } from '../src/common/middleware/rate-limit.js';
import { ErrorResponseSchema } from '../src/common/schemas/error.js';
import { TOKEN_ISSUER, TOKEN_AUDIENCE } from '../src/config/constants.js';
import type { AppConfig } from '../src/config/env.js';
import type { DatabaseHealth } from '../src/infrastructure/database/database.js';
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
  InvitationNotForUserError,
  NotOwnerError,
  ProjectNotShareableError,
  ScanNotShareableError,
  ShareLinkExpiredError,
  ShareLinkNotFoundError,
  ShareNoLongerAvailableError,
  ViewerAccessNotFoundError,
} from '../src/modules/share/share.errors.js';
import {
  InvitationAcceptResponseSchema,
  InvitationCreateResponseSchema,
  InvitationDeclineResponseSchema,
  InvitationPreviewResponseSchema,
  InvitationResendResponseSchema,
  InvitationRevokeResponseSchema,
  ScanSharesListResponseSchema,
  ScanViewerRevokeResponseSchema,
  ShareLinkCreateResponseSchema,
  ShareLinkListResponseSchema,
  ShareLinkRevokeResponseSchema,
  SharesListResponseSchema,
  ViewerRevokeResponseSchema,
} from '../src/modules/share/share.schemas.js';
import type { ShareService } from '../src/modules/share/share.service.js';
import type { ShareLinkService } from '../src/modules/share/share-link.service.js';
import type { SharedProjectsService } from '../src/modules/shared-projects/shared-projects.service.js';
import type { SharedScansService } from '../src/modules/shared-scans/shared-scans.service.js';
import type { NoteService } from '../src/modules/note/note.service.js';
import type { ProjectService } from '../src/modules/project/project.service.js';
import type { ScanService } from '../src/modules/scan/scan.service.js';
import type { ScanAssetService } from '../src/modules/scan-asset/scan-asset.service.js';

const ACCESS_SECRET = 'access-secret-that-is-at-least-32-characters';
const USER_OWNER = 'eb5d278f-c857-45c7-887d-7be65288cb75';
const USER_RECIPIENT = 'f1a2b3c4-d5e6-7890-abcd-ef1234567890';
const PROJECT_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const SCAN_ID = 'f1e2d3c4-a5b6-7890-abcd-ef1234567890';
const INVITATION_ID = 'b1a2c3d4-e5f6-4890-abcd-ef1234567890';
const SHARE_LINK_ID = 'c0ffee00-0000-4000-8000-0000000000aa';
const TOKEN = 'A'.repeat(43);
const RECIPIENT_EMAIL = 'recipient@example.com';
const NOW = new Date('2026-07-29T10:00:00.000Z');

const config: AppConfig = {
  nodeEnv: 'test',
  port: 3000,
  databaseUrl: 'postgresql://roomscan:roomscan@localhost:5432/roomscan',
  logLevel: 'silent',
  corsOrigins: '*',
  trustProxy: false,
  apiRateLimitWindowSeconds: 60,
  apiRateLimitMaxRequests: 120,
  appleAuthRateLimitWindowSeconds: 900,
  appleAuthRateLimitMaxRequests: 20,
  refreshAuthRateLimitWindowSeconds: 900,
  refreshAuthRateLimitMaxRequests: 10,
  appleClientId: 'com.example.roomscan',
  accessTokenSecret: ACCESS_SECRET,
  refreshTokenSecret: 'refresh-secret-that-is-at-least-32-characters',
  accessTokenTtlSeconds: 3600,
  refreshTokenTtlSeconds: 2_592_000,
  localTestAuthEnabled: false,
  storageProvider: 'local',
  storageBucket: '',
  storageRegion: '',
  storageEndpoint: '',
  storageAccessKeyId: '',
  storageSecretAccessKey: '',
  storageUseSsl: false,
  storageUploadUrlTtlSeconds: 900,
  storageDownloadUrlTtlSeconds: 60,
  assetMinModelSizeBytes: 10_000_000,
  assetMaxModelSizeBytes: 500_000_000,
  assetMaxThumbnailSizeBytes: 10_000_000,
  invitationTtlSeconds: 604_800,
  invitationBaseUrl: 'https://invite.roomscan.dev',
  mailProvider: 'log',
  smtpHost: '',
  smtpPort: 2525,
  smtpUser: '',
  smtpPass: '',
  smtpSecure: false,
  mailFrom: 'RoomScan App <notifications@roomscan.app>',
};

const invitationUrl = `https://invite.roomscan.dev/invitations/${TOKEN}?scope=project`;
const expiresAt = new Date(NOW.getTime() + 604_800 * 1000).toISOString();

async function signAccessToken(userId: string): Promise<string> {
  return new SignJWT({ tokenType: 'access' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setIssuer(TOKEN_ISSUER)
    .setAudience(TOKEN_AUDIENCE)
    .setIssuedAt(Math.floor(NOW.getTime() / 1000))
    .setExpirationTime(Math.floor(NOW.getTime() / 1000) + 3600)
    .sign(new TextEncoder().encode(ACCESS_SECRET));
}

describe('Share HTTP endpoints', () => {
  const database: DatabaseHealth = {
    checkConnection: vi.fn(() => Promise.resolve()),
    disconnect: vi.fn(() => Promise.resolve()),
  };
  const logger = pino({ enabled: false });
  const rateLimiters = createRateLimiters(config, logger);
  const authService = { signInWithApple: vi.fn() };
  const refreshTokenService = { refresh: vi.fn() };
  const accessTokenVerifier: AccessTokenVerifier = {
    verify: vi.fn(async (token: string) => {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(ACCESS_SECRET), {
        algorithms: ['HS256'],
        issuer: TOKEN_ISSUER,
        audience: TOKEN_AUDIENCE,
        currentDate: NOW,
      });
      return { userId: payload.sub as string };
    }),
  };
  const currentUserRepository: CurrentUserRepository = {
    findById: vi.fn((userId: string) =>
      Promise.resolve({
        id: userId,
        email: userId === USER_OWNER ? 'owner@example.com' : 'recipient@example.com',
      }),
    ),
  };
  const projectService = {
    create: vi.fn(),
    list: vi.fn(),
    getById: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  } as unknown as ProjectService;
  const scanService = {
    create: vi.fn(),
    list: vi.fn(),
    getById: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  } as unknown as ScanService;
  const scanAssetService = {
    createUploadSession: vi.fn(),
    completeUpload: vi.fn(),
    listAssets: vi.fn(),
    getDownloadUrl: vi.fn(),
    failUpload: vi.fn(),
  } as unknown as ScanAssetService;
  const noteService = {
    create: vi.fn(),
    list: vi.fn(),
    getById: vi.fn(),
    update: vi.fn(),
    move: vi.fn(),
    delete: vi.fn(),
  } as unknown as NoteService;
  const createInvitation = vi.fn<ShareService['createInvitation']>();
  const createScanInvitation = vi.fn<ShareService['createScanInvitation']>();
  const previewInvitation = vi.fn<ShareService['previewInvitation']>();
  const acceptInvitation = vi.fn<ShareService['acceptInvitation']>();
  const declineInvitation = vi.fn<ShareService['declineInvitation']>();
  const revokeInvitation = vi.fn<ShareService['revokeInvitation']>();
  const resendInvitation = vi.fn<ShareService['resendInvitation']>();
  const listShares = vi.fn<ShareService['listShares']>();
  const listScanShares = vi.fn<ShareService['listScanShares']>();
  const revokeViewer = vi.fn<ShareService['revokeViewer']>();
  const revokeScanViewer = vi.fn<ShareService['revokeScanViewer']>();
  const shareService = {
    createInvitation,
    createScanInvitation,
    previewInvitation,
    acceptInvitation,
    declineInvitation,
    revokeInvitation,
    resendInvitation,
    listShares,
    listScanShares,
    revokeViewer,
    revokeScanViewer,
  } as unknown as ShareService;
  const createShareLink = vi.fn<ShareLinkService['createShareLink']>();
  const listShareLinks = vi.fn<ShareLinkService['listShareLinks']>();
  const revokeShareLink = vi.fn<ShareLinkService['revokeShareLink']>();
  const shareLinkService = {
    createShareLink,
    listShareLinks,
    revokeShareLink,
  } as unknown as ShareLinkService;
  const sharedProjectsService = {
    list: vi.fn(),
    detail: vi.fn(),
    remove: vi.fn(),
  } as unknown as SharedProjectsService;
  const sharedScansService = {
    list: vi.fn(),
    detail: vi.fn(),
    remove: vi.fn(),
  } as unknown as SharedScansService;
  const app = createApp({
    config,
    database,
    logger,
    authService,
    refreshTokenService,
    projectService,
    scanService,
    scanAssetService,
    noteService,
    shareService,
    shareLinkService,
    sharedProjectsService,
    sharedScansService,
    accessTokenVerifier,
    currentUserRepository,
    rateLimiters,
    clock: () => NOW,
  });

  let ownerToken: string;
  let recipientToken: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    ownerToken = await signAccessToken(USER_OWNER);
    recipientToken = await signAccessToken(USER_RECIPIENT);
    createInvitation.mockResolvedValue({
      invitationId: INVITATION_ID,
      invitationUrl,
      recipientEmail: RECIPIENT_EMAIL,
      expiresAt,
      status: 'PENDING',
      sentAt: NOW.toISOString(),
    });
    previewInvitation.mockResolvedValue({
      type: 'invitation',
      scope: 'project',
      project: {
        id: PROJECT_ID,
        name: 'District 2 Apartment',
        description: null,
        thumbnail: null,
        owner: { id: USER_OWNER, email: 'owner@example.com' },
        scanCount: 2,
      },
      scan: null,
      status: 'PENDING',
      sentAt: NOW.toISOString(),
      expiresAt,
    });
    acceptInvitation.mockResolvedValue({
      type: 'invitation',
      invitationId: INVITATION_ID,
      scope: 'project',
      project: {
        id: PROJECT_ID,
        name: 'District 2 Apartment',
        description: null,
        thumbnail: null,
        owner: { id: USER_OWNER, email: 'owner@example.com' },
        scanCount: 2,
      },
      scan: null,
      access: { role: 'VIEWER', status: 'ACTIVE', grantedAt: NOW.toISOString() },
    });
    declineInvitation.mockResolvedValue({
      invitationId: INVITATION_ID,
      status: 'DECLINED',
      declinedAt: NOW.toISOString(),
    });
    revokeInvitation.mockResolvedValue({
      invitationId: INVITATION_ID,
      status: 'REVOKED',
      revokedAt: NOW.toISOString(),
    });
    resendInvitation.mockResolvedValue({
      invitationId: INVITATION_ID,
      invitationUrl,
      recipientEmail: RECIPIENT_EMAIL,
      expiresAt,
      status: 'PENDING',
      sentAt: NOW.toISOString(),
    });
    listShares.mockResolvedValue({
      pendingInvitations: [
        {
          invitationId: INVITATION_ID,
          recipientEmail: RECIPIENT_EMAIL,
          status: 'PENDING',
          sentAt: NOW.toISOString(),
          expiresAt,
        },
      ],
      viewers: [
        {
          userId: USER_RECIPIENT,
          recipientUser: { id: USER_RECIPIENT, email: 'recipient@example.com' },
          grantedAt: NOW.toISOString(),
        },
      ],
    });
    revokeViewer.mockResolvedValue({
      projectId: PROJECT_ID,
      userId: USER_RECIPIENT,
      revokedAt: NOW.toISOString(),
    });
    createScanInvitation.mockResolvedValue({
      invitationId: INVITATION_ID,
      invitationUrl,
      recipientEmail: RECIPIENT_EMAIL,
      expiresAt,
      status: 'PENDING',
      sentAt: NOW.toISOString(),
    });
    listScanShares.mockResolvedValue({
      pendingInvitations: [
        {
          invitationId: INVITATION_ID,
          recipientEmail: RECIPIENT_EMAIL,
          status: 'PENDING',
          sentAt: NOW.toISOString(),
          expiresAt,
        },
      ],
      viewers: [
        {
          userId: USER_RECIPIENT,
          recipientUser: { id: USER_RECIPIENT, email: 'recipient@example.com' },
          grantedAt: NOW.toISOString(),
        },
      ],
    });
    revokeScanViewer.mockResolvedValue({
      scanId: SCAN_ID,
      userId: USER_RECIPIENT,
      revokedAt: NOW.toISOString(),
    });
    createShareLink.mockResolvedValue({
      shareLinkId: SHARE_LINK_ID,
      shareLinkUrl: `https://invite.roomscan.dev/invitations/${TOKEN}?scope=project`,
      scope: 'project',
      expiresAt,
    });
    listShareLinks.mockResolvedValue([
      {
        shareLinkId: SHARE_LINK_ID,
        status: 'ACTIVE',
        expiresAt,
        createdAt: NOW.toISOString(),
      },
    ]);
    revokeShareLink.mockResolvedValue({
      shareLinkId: SHARE_LINK_ID,
      status: 'REVOKED',
      revokedAt: NOW.toISOString(),
    });
  });

  describe('POST /api/v1/projects/:projectId/invitations', () => {
    it('creates an invitation link for the owner', async () => {
      const response = await request(app)
        .post(`/api/v1/projects/${PROJECT_ID}/invitations`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ recipientEmail: RECIPIENT_EMAIL, expiresInSeconds: 3600 })
        .expect(201);

      const body = InvitationCreateResponseSchema.parse(response.body as unknown);
      expect(body).toEqual({
        invitationId: INVITATION_ID,
        invitationUrl,
        recipientEmail: RECIPIENT_EMAIL,
        expiresAt,
        status: 'PENDING',
        sentAt: NOW.toISOString(),
      });
      expect(createInvitation).toHaveBeenCalledWith(USER_OWNER, PROJECT_ID, {
        recipientEmail: RECIPIENT_EMAIL,
        expiresInSeconds: 3600,
      });
    });

    it('creates an invitation without an explicit expiry', async () => {
      await request(app)
        .post(`/api/v1/projects/${PROJECT_ID}/invitations`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ recipientEmail: RECIPIENT_EMAIL })
        .expect(201);

      expect(createInvitation).toHaveBeenCalledWith(USER_OWNER, PROJECT_ID, {
        recipientEmail: RECIPIENT_EMAIL,
      });
    });

    it('rejects a duplicate pending invitation with 409', async () => {
      createInvitation.mockRejectedValue(new InvitationAlreadySentError());

      const response = await request(app)
        .post(`/api/v1/projects/${PROJECT_ID}/invitations`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ recipientEmail: RECIPIENT_EMAIL })
        .expect(409);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe(
        'INVITATION_ALREADY_SENT',
      );
    });

    it('rejects a non-owner with 403', async () => {
      createInvitation.mockRejectedValue(new NotOwnerError());

      const response = await request(app)
        .post(`/api/v1/projects/${PROJECT_ID}/invitations`)
        .set('Authorization', `Bearer ${recipientToken}`)
        .send({ recipientEmail: RECIPIENT_EMAIL })
        .expect(403);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe('NOT_OWNER');
    });

    it('rejects a missing project with 404', async () => {
      createInvitation.mockRejectedValue(new ProjectNotFoundError());

      const response = await request(app)
        .post(`/api/v1/projects/${PROJECT_ID}/invitations`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ recipientEmail: RECIPIENT_EMAIL })
        .expect(404);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe(
        'PROJECT_NOT_FOUND',
      );
    });

    it('rejects a project that is not ready to share with 409', async () => {
      createInvitation.mockRejectedValue(new ProjectNotShareableError());

      const response = await request(app)
        .post(`/api/v1/projects/${PROJECT_ID}/invitations`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ recipientEmail: RECIPIENT_EMAIL })
        .expect(409);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe(
        'PROJECT_NOT_SHAREABLE',
      );
    });

    it('rejects a request without authentication', async () => {
      const response = await request(app)
        .post(`/api/v1/projects/${PROJECT_ID}/invitations`)
        .send({ recipientEmail: RECIPIENT_EMAIL })
        .expect(401);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe('UNAUTHORIZED');
      expect(createInvitation).not.toHaveBeenCalled();
    });

    it.each([
      {},
      { recipientEmail: 'not-an-email' },
      { recipientEmail: RECIPIENT_EMAIL, expiresInSeconds: 0 },
      { recipientEmail: RECIPIENT_EMAIL, expiresInSeconds: 59 },
      { recipientEmail: RECIPIENT_EMAIL, expiresInSeconds: 2_592_001 },
      { recipientEmail: RECIPIENT_EMAIL, unexpected: true },
    ])('rejects an invalid body %j', async (body) => {
      const response = await request(app)
        .post(`/api/v1/projects/${PROJECT_ID}/invitations`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(body)
        .expect(400);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe(
        'VALIDATION_ERROR',
      );
    });
  });

  describe('POST /api/v1/invitations/:invitationId/resend', () => {
    it('resends a pending invitation as the owner', async () => {
      const response = await request(app)
        .post(`/api/v1/invitations/${INVITATION_ID}/resend`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const body = InvitationResendResponseSchema.parse(response.body as unknown);
      expect(body).toEqual({
        invitationId: INVITATION_ID,
        invitationUrl,
        recipientEmail: RECIPIENT_EMAIL,
        expiresAt,
        status: 'PENDING',
        sentAt: NOW.toISOString(),
      });
      expect(resendInvitation).toHaveBeenCalledWith(USER_OWNER, INVITATION_ID);
    });

    it('rejects an unauthenticated resend with 401', async () => {
      const response = await request(app)
        .post(`/api/v1/invitations/${INVITATION_ID}/resend`)
        .expect(401);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe('UNAUTHORIZED');
      expect(resendInvitation).not.toHaveBeenCalled();
    });

    it('rejects a non-owner with 403', async () => {
      resendInvitation.mockRejectedValue(new NotOwnerError());

      const response = await request(app)
        .post(`/api/v1/invitations/${INVITATION_ID}/resend`)
        .set('Authorization', `Bearer ${recipientToken}`)
        .expect(403);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe('NOT_OWNER');
    });

    it('rejects an already accepted invitation with 409', async () => {
      resendInvitation.mockRejectedValue(new InvitationAlreadyAcceptedError());

      const response = await request(app)
        .post(`/api/v1/invitations/${INVITATION_ID}/resend`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(409);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe(
        'INVITATION_ALREADY_ACCEPTED',
      );
    });
  });

  describe('GET /api/v1/invitations/:token', () => {
    it('previews a valid invitation when authenticated', async () => {
      const response = await request(app)
        .get(`/api/v1/invitations/${TOKEN}`)
        .set('Authorization', `Bearer ${recipientToken}`)
        .expect(200);

      const body = InvitationPreviewResponseSchema.parse(response.body as unknown);
      expect(body).toEqual({
        type: 'invitation',
        scope: 'project',
        project: {
          id: PROJECT_ID,
          name: 'District 2 Apartment',
          description: null,
          thumbnail: null,
          owner: { id: USER_OWNER, email: 'owner@example.com' },
          scanCount: 2,
        },
        scan: null,
        status: 'PENDING',
        sentAt: NOW.toISOString(),
        expiresAt,
      });
      expect(previewInvitation).toHaveBeenCalledWith(TOKEN, {
        id: USER_RECIPIENT,
        email: RECIPIENT_EMAIL,
      });
    });

    it('rejects an unauthenticated preview with 401', async () => {
      const response = await request(app).get(`/api/v1/invitations/${TOKEN}`).expect(401);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe('UNAUTHORIZED');
      expect(previewInvitation).not.toHaveBeenCalled();
    });

    it('reports hasAccess when a valid token is supplied', async () => {
      previewInvitation.mockResolvedValue({
        type: 'invitation',
        scope: 'project',
        project: {
          id: PROJECT_ID,
          name: 'District 2 Apartment',
          description: null,
          thumbnail: null,
          owner: { id: USER_OWNER, email: 'owner@example.com' },
          scanCount: 2,
        },
        scan: null,
        status: 'PENDING',
        recipientEmail: RECIPIENT_EMAIL,
        sentAt: NOW.toISOString(),
        expiresAt,
        hasAccess: true,
      });

      const response = await request(app)
        .get(`/api/v1/invitations/${TOKEN}`)
        .set('Authorization', `Bearer ${recipientToken}`)
        .expect(200);

      expect((response.body as Record<string, unknown>).hasAccess).toBe(true);
      expect(previewInvitation).toHaveBeenCalledWith(TOKEN, {
        id: USER_RECIPIENT,
        email: RECIPIENT_EMAIL,
      });
    });

    it('returns 404 for an unknown token', async () => {
      previewInvitation.mockRejectedValue(new InvitationNotFoundError());

      const response = await request(app)
        .get(`/api/v1/invitations/${TOKEN}`)
        .set('Authorization', `Bearer ${recipientToken}`)
        .expect(404);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe(
        'INVITATION_NOT_FOUND',
      );
    });

    it('returns 404 SHARE_NO_LONGER_AVAILABLE for a revoked or deleted source', async () => {
      previewInvitation.mockRejectedValue(new ShareNoLongerAvailableError());

      const response = await request(app)
        .get(`/api/v1/invitations/${TOKEN}`)
        .set('Authorization', `Bearer ${recipientToken}`)
        .expect(404);

      const body = ErrorResponseSchema.parse(response.body as unknown);
      expect(body.error.code).toBe('SHARE_NO_LONGER_AVAILABLE');
      expect(body.error.message).toBe('This project/scan is no longer available.');
    });

    it('returns 403 with a no-permission code when the email does not match the invite', async () => {
      previewInvitation.mockRejectedValue(new InvitationNotForUserError());

      const response = await request(app)
        .get(`/api/v1/invitations/${TOKEN}`)
        .set('Authorization', `Bearer ${recipientToken}`)
        .expect(403);

      const body = ErrorResponseSchema.parse(response.body as unknown);
      expect(body.error.code).toBe('INVITATION_NOT_FOR_USER');
      expect(body.error.message).toBe('You do not have permission to access this item');
    });

    it('returns 400 for a malformed token', async () => {
      const response = await request(app)
        .get('/api/v1/invitations/not-a-valid-token')
        .set('Authorization', `Bearer ${recipientToken}`)
        .expect(400);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe(
        'VALIDATION_ERROR',
      );
      expect(previewInvitation).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/v1/invitations/:token/accept', () => {
    it('accepts a valid invitation and creates Viewer access', async () => {
      const response = await request(app)
        .post(`/api/v1/invitations/${TOKEN}/accept`)
        .set('Authorization', `Bearer ${recipientToken}`)
        .expect(200);

      const body = InvitationAcceptResponseSchema.parse(response.body as unknown);
      expect(body).toEqual({
        type: 'invitation',
        invitationId: INVITATION_ID,
        scope: 'project',
        project: {
          id: PROJECT_ID,
          name: 'District 2 Apartment',
          description: null,
          thumbnail: null,
          owner: { id: USER_OWNER, email: 'owner@example.com' },
        },
        scan: null,
        access: { role: 'VIEWER', status: 'ACTIVE', grantedAt: NOW.toISOString() },
      });
      expect(acceptInvitation).toHaveBeenCalledWith(
        { id: USER_RECIPIENT, email: RECIPIENT_EMAIL },
        TOKEN,
      );
    });

    it('rejects an unauthenticated accept with 401', async () => {
      const response = await request(app).post(`/api/v1/invitations/${TOKEN}/accept`).expect(401);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe('UNAUTHORIZED');
      expect(acceptInvitation).not.toHaveBeenCalled();
    });

    it.each([
      ['unknown token', new InvitationNotFoundError(), 404, 'INVITATION_NOT_FOUND'],
      ['expired invitation', new InvitationExpiredError(), 409, 'INVITATION_EXPIRED'],
      ['revoked invitation', new ShareNoLongerAvailableError(), 404, 'SHARE_NO_LONGER_AVAILABLE'],
      ['already declined invitation', new InvitationDeclinedError(), 409, 'INVITATION_DECLINED'],
      [
        'already accepted invitation',
        new InvitationAlreadyAcceptedError(),
        409,
        'INVITATION_ALREADY_ACCEPTED',
      ],
      ['user already has access', new AccessAlreadyExistsError(), 409, 'ACCESS_ALREADY_EXISTS'],
      [
        'owner self-accept',
        new CannotAcceptOwnInvitationError(),
        409,
        'CANNOT_ACCEPT_OWN_INVITATION',
      ],
      ['revoked share link', new ShareNoLongerAvailableError(), 404, 'SHARE_NO_LONGER_AVAILABLE'],
      ['expired share link', new ShareLinkExpiredError(), 409, 'SHARE_LINK_EXPIRED'],
    ])('rejects an %s with %i %s', async (_label, error, status, code) => {
      acceptInvitation.mockRejectedValue(error);

      const response = await request(app)
        .post(`/api/v1/invitations/${TOKEN}/accept`)
        .set('Authorization', `Bearer ${recipientToken}`)
        .expect(status);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe(code);
    });

    it('returns 400 for a malformed token', async () => {
      const response = await request(app)
        .post('/api/v1/invitations/not-a-valid-token/accept')
        .set('Authorization', `Bearer ${recipientToken}`)
        .expect(400);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe(
        'VALIDATION_ERROR',
      );
    });
  });

  describe('POST /api/v1/invitations/:token/decline', () => {
    it('declines a valid invitation', async () => {
      const response = await request(app)
        .post(`/api/v1/invitations/${TOKEN}/decline`)
        .set('Authorization', `Bearer ${recipientToken}`)
        .expect(200);

      const body = InvitationDeclineResponseSchema.parse(response.body as unknown);
      expect(body).toEqual({
        invitationId: INVITATION_ID,
        status: 'DECLINED',
        declinedAt: NOW.toISOString(),
      });
      expect(declineInvitation).toHaveBeenCalledWith(
        { id: USER_RECIPIENT, email: RECIPIENT_EMAIL },
        TOKEN,
      );
    });

    it('rejects an unauthenticated decline with 401', async () => {
      const response = await request(app).post(`/api/v1/invitations/${TOKEN}/decline`).expect(401);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe('UNAUTHORIZED');
    });

    it('rejects an expired invitation with 409', async () => {
      declineInvitation.mockRejectedValue(new InvitationExpiredError());

      const response = await request(app)
        .post(`/api/v1/invitations/${TOKEN}/decline`)
        .set('Authorization', `Bearer ${recipientToken}`)
        .expect(409);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe(
        'INVITATION_EXPIRED',
      );
    });
  });

  describe('DELETE /api/v1/invitations/:invitationId', () => {
    it('revokes a pending invitation as the owner', async () => {
      const response = await request(app)
        .delete(`/api/v1/invitations/${INVITATION_ID}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const body = InvitationRevokeResponseSchema.parse(response.body as unknown);
      expect(body).toEqual({
        invitationId: INVITATION_ID,
        status: 'REVOKED',
        revokedAt: NOW.toISOString(),
      });
      expect(revokeInvitation).toHaveBeenCalledWith(USER_OWNER, INVITATION_ID);
    });

    it('rejects a non-owner with 403', async () => {
      revokeInvitation.mockRejectedValue(new NotOwnerError());

      const response = await request(app)
        .delete(`/api/v1/invitations/${INVITATION_ID}`)
        .set('Authorization', `Bearer ${recipientToken}`)
        .expect(403);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe('NOT_OWNER');
    });
  });

  describe('GET /api/v1/projects/:projectId/shares', () => {
    it('lists pending invitations and accepted viewers for the owner', async () => {
      const response = await request(app)
        .get(`/api/v1/projects/${PROJECT_ID}/shares`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const body = SharesListResponseSchema.parse(response.body as unknown);
      expect(body).toEqual({
        pendingInvitations: [
          {
            invitationId: INVITATION_ID,
            recipientEmail: RECIPIENT_EMAIL,
            status: 'PENDING',
            sentAt: NOW.toISOString(),
            expiresAt,
          },
        ],
        viewers: [
          {
            userId: USER_RECIPIENT,
            recipientUser: { id: USER_RECIPIENT, email: 'recipient@example.com' },
            grantedAt: NOW.toISOString(),
          },
        ],
      });
      expect(listShares).toHaveBeenCalledWith(USER_OWNER, PROJECT_ID);
    });

    it('rejects a non-owner with 403', async () => {
      listShares.mockRejectedValue(new NotOwnerError());

      const response = await request(app)
        .get(`/api/v1/projects/${PROJECT_ID}/shares`)
        .set('Authorization', `Bearer ${recipientToken}`)
        .expect(403);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe('NOT_OWNER');
    });
  });

  describe('DELETE /api/v1/projects/:projectId/shares/:userId', () => {
    it('revokes Viewer access as the owner', async () => {
      const response = await request(app)
        .delete(`/api/v1/projects/${PROJECT_ID}/shares/${USER_RECIPIENT}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const body = ViewerRevokeResponseSchema.parse(response.body as unknown);
      expect(body).toEqual({
        projectId: PROJECT_ID,
        userId: USER_RECIPIENT,
        revokedAt: NOW.toISOString(),
      });
      expect(revokeViewer).toHaveBeenCalledWith(USER_OWNER, PROJECT_ID, USER_RECIPIENT);
    });

    it('rejects a non-owner with 403', async () => {
      revokeViewer.mockRejectedValue(new NotOwnerError());

      const response = await request(app)
        .delete(`/api/v1/projects/${PROJECT_ID}/shares/${USER_RECIPIENT}`)
        .set('Authorization', `Bearer ${recipientToken}`)
        .expect(403);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe('NOT_OWNER');
    });

    it('rejects when no access record exists with 404', async () => {
      revokeViewer.mockRejectedValue(new ViewerAccessNotFoundError());

      const response = await request(app)
        .delete(`/api/v1/projects/${PROJECT_ID}/shares/${USER_RECIPIENT}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe(
        'ACCESS_NOT_FOUND',
      );
    });
  });

  describe('error envelope', () => {
    it('returns a request ID with share errors', async () => {
      acceptInvitation.mockRejectedValue(new InvitationExpiredError());

      const response = await request(app)
        .post(`/api/v1/invitations/${TOKEN}/accept`)
        .set('Authorization', `Bearer ${recipientToken}`)
        .expect(409);

      const body = ErrorResponseSchema.parse(response.body as unknown);
      expect(response.headers['x-request-id']).toEqual(expect.any(String));
      expect(body.requestId).toBe(response.headers['x-request-id']);
    });
  });

  describe('POST /api/v1/scans/:scanId/invitations', () => {
    it('creates a scan-scope invitation for the owner', async () => {
      const response = await request(app)
        .post(`/api/v1/scans/${SCAN_ID}/invitations`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ recipientEmail: RECIPIENT_EMAIL })
        .expect(201);

      const body = InvitationCreateResponseSchema.parse(response.body as unknown);
      expect(body.status).toBe('PENDING');
      expect(createScanInvitation).toHaveBeenCalledWith(USER_OWNER, SCAN_ID, {
        recipientEmail: RECIPIENT_EMAIL,
      });
    });

    it('rejects an unauthenticated request', async () => {
      const response = await request(app)
        .post(`/api/v1/scans/${SCAN_ID}/invitations`)
        .send({ recipientEmail: RECIPIENT_EMAIL })
        .expect(401);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe('UNAUTHORIZED');
      expect(createScanInvitation).not.toHaveBeenCalled();
    });

    it('rejects a scan that is not shareable with 409', async () => {
      createScanInvitation.mockRejectedValue(new ScanNotShareableError());

      const response = await request(app)
        .post(`/api/v1/scans/${SCAN_ID}/invitations`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ recipientEmail: RECIPIENT_EMAIL })
        .expect(409);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe(
        'SCAN_NOT_SHAREABLE',
      );
    });

    it('rejects a missing scan with 404', async () => {
      createScanInvitation.mockRejectedValue(new ScanNotFoundError());

      const response = await request(app)
        .post(`/api/v1/scans/${SCAN_ID}/invitations`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ recipientEmail: RECIPIENT_EMAIL })
        .expect(404);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe('SCAN_NOT_FOUND');
    });

    it('rejects an invalid body with 400', async () => {
      const response = await request(app)
        .post(`/api/v1/scans/${SCAN_ID}/invitations`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ recipientEmail: 'not-an-email' })
        .expect(400);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe(
        'VALIDATION_ERROR',
      );
    });

    it('rejects a non-owner with 403', async () => {
      createScanInvitation.mockRejectedValue(new NotOwnerError());

      const response = await request(app)
        .post(`/api/v1/scans/${SCAN_ID}/invitations`)
        .set('Authorization', `Bearer ${recipientToken}`)
        .send({ recipientEmail: RECIPIENT_EMAIL })
        .expect(403);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe('NOT_OWNER');
    });

    it('rejects a duplicate pending scan invitation with 409', async () => {
      createScanInvitation.mockRejectedValue(new InvitationAlreadySentError());

      const response = await request(app)
        .post(`/api/v1/scans/${SCAN_ID}/invitations`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ recipientEmail: RECIPIENT_EMAIL })
        .expect(409);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe(
        'INVITATION_ALREADY_SENT',
      );
    });
  });

  describe('GET /api/v1/scans/:scanId/shares', () => {
    it('lists scan pending invitations and scan viewers for the owner', async () => {
      const response = await request(app)
        .get(`/api/v1/scans/${SCAN_ID}/shares`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const body = ScanSharesListResponseSchema.parse(response.body as unknown);
      expect(body.pendingInvitations).toHaveLength(1);
      expect(body.viewers).toHaveLength(1);
      expect(listScanShares).toHaveBeenCalledWith(USER_OWNER, SCAN_ID);
    });

    it('rejects a non-owner with 403', async () => {
      listScanShares.mockRejectedValue(new NotOwnerError());

      const response = await request(app)
        .get(`/api/v1/scans/${SCAN_ID}/shares`)
        .set('Authorization', `Bearer ${recipientToken}`)
        .expect(403);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe('NOT_OWNER');
    });

    it('rejects a missing scan with 404', async () => {
      listScanShares.mockRejectedValue(new ScanNotFoundError());

      const response = await request(app)
        .get(`/api/v1/scans/${SCAN_ID}/shares`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe('SCAN_NOT_FOUND');
    });
  });

  describe('DELETE /api/v1/scans/:scanId/shares/:userId', () => {
    it('revokes scan Viewer access as the owner', async () => {
      const response = await request(app)
        .delete(`/api/v1/scans/${SCAN_ID}/shares/${USER_RECIPIENT}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const body = ScanViewerRevokeResponseSchema.parse(response.body as unknown);
      expect(body).toEqual({
        scanId: SCAN_ID,
        userId: USER_RECIPIENT,
        revokedAt: NOW.toISOString(),
      });
      expect(revokeScanViewer).toHaveBeenCalledWith(USER_OWNER, SCAN_ID, USER_RECIPIENT);
    });

    it('rejects a non-owner with 403', async () => {
      revokeScanViewer.mockRejectedValue(new NotOwnerError());

      const response = await request(app)
        .delete(`/api/v1/scans/${SCAN_ID}/shares/${USER_RECIPIENT}`)
        .set('Authorization', `Bearer ${recipientToken}`)
        .expect(403);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe('NOT_OWNER');
    });

    it('rejects when no scan access record exists with 404', async () => {
      revokeScanViewer.mockRejectedValue(new ViewerAccessNotFoundError());

      const response = await request(app)
        .delete(`/api/v1/scans/${SCAN_ID}/shares/${USER_RECIPIENT}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe(
        'ACCESS_NOT_FOUND',
      );
    });
  });

  describe('POST /api/v1/projects/:projectId/share-links', () => {
    it('creates a generic project share link for the owner', async () => {
      const response = await request(app)
        .post(`/api/v1/projects/${PROJECT_ID}/share-links`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(201);

      const body = ShareLinkCreateResponseSchema.parse(response.body as unknown);
      expect(body).toEqual({
        shareLinkId: SHARE_LINK_ID,
        shareLinkUrl: `https://invite.roomscan.dev/invitations/${TOKEN}?scope=project`,
        scope: 'project',
        expiresAt,
      });
      expect(createShareLink).toHaveBeenCalledWith(USER_OWNER, { projectId: PROJECT_ID });
    });

    it('rejects an unauthenticated request', async () => {
      const response = await request(app)
        .post(`/api/v1/projects/${PROJECT_ID}/share-links`)
        .expect(401);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe('UNAUTHORIZED');
      expect(createShareLink).not.toHaveBeenCalled();
    });

    it('rejects a non-owner with 403', async () => {
      createShareLink.mockRejectedValue(new NotOwnerError());

      const response = await request(app)
        .post(`/api/v1/projects/${PROJECT_ID}/share-links`)
        .set('Authorization', `Bearer ${recipientToken}`)
        .expect(403);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe('NOT_OWNER');
    });

    it('rejects a project that is not shareable with 409', async () => {
      createShareLink.mockRejectedValue(new ProjectNotShareableError());

      const response = await request(app)
        .post(`/api/v1/projects/${PROJECT_ID}/share-links`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(409);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe(
        'PROJECT_NOT_SHAREABLE',
      );
    });

    it('rejects a missing project with 404', async () => {
      createShareLink.mockRejectedValue(new ProjectNotFoundError());

      const response = await request(app)
        .post(`/api/v1/projects/${PROJECT_ID}/share-links`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe(
        'PROJECT_NOT_FOUND',
      );
    });
  });

  describe('POST /api/v1/scans/:scanId/share-links', () => {
    it('creates a generic scan share link for the owner', async () => {
      createShareLink.mockResolvedValue({
        shareLinkId: SHARE_LINK_ID,
        shareLinkUrl: `https://invite.roomscan.dev/invitations/${TOKEN}?scope=scan`,
        scope: 'scan',
        expiresAt,
      });

      const response = await request(app)
        .post(`/api/v1/scans/${SCAN_ID}/share-links`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(201);

      const body = ShareLinkCreateResponseSchema.parse(response.body as unknown);
      expect(body.scope).toBe('scan');
      expect(createShareLink).toHaveBeenCalledWith(USER_OWNER, { scanId: SCAN_ID });
    });

    it('rejects a scan that is not shareable with 409', async () => {
      createShareLink.mockRejectedValue(new ScanNotShareableError());

      const response = await request(app)
        .post(`/api/v1/scans/${SCAN_ID}/share-links`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(409);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe(
        'SCAN_NOT_SHAREABLE',
      );
    });

    it('rejects a missing scan with 404', async () => {
      createShareLink.mockRejectedValue(new ScanNotFoundError());

      const response = await request(app)
        .post(`/api/v1/scans/${SCAN_ID}/share-links`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe('SCAN_NOT_FOUND');
    });
  });

  describe('GET /api/v1/projects/:projectId/share-links', () => {
    it('lists active project share links for the owner', async () => {
      const response = await request(app)
        .get(`/api/v1/projects/${PROJECT_ID}/share-links`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const body = ShareLinkListResponseSchema.parse(response.body as unknown);
      expect(body.items).toHaveLength(1);
      expect(listShareLinks).toHaveBeenCalledWith(USER_OWNER, { projectId: PROJECT_ID });
    });

    it('rejects a non-owner with 403', async () => {
      listShareLinks.mockRejectedValue(new NotOwnerError());

      const response = await request(app)
        .get(`/api/v1/projects/${PROJECT_ID}/share-links`)
        .set('Authorization', `Bearer ${recipientToken}`)
        .expect(403);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe('NOT_OWNER');
    });
  });

  describe('GET /api/v1/scans/:scanId/share-links', () => {
    it('lists active scan share links for the owner', async () => {
      const response = await request(app)
        .get(`/api/v1/scans/${SCAN_ID}/share-links`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const body = ShareLinkListResponseSchema.parse(response.body as unknown);
      expect(body.items).toHaveLength(1);
      expect(listShareLinks).toHaveBeenCalledWith(USER_OWNER, { scanId: SCAN_ID });
    });

    it('rejects a missing scan with 404', async () => {
      listShareLinks.mockRejectedValue(new ScanNotFoundError());

      const response = await request(app)
        .get(`/api/v1/scans/${SCAN_ID}/share-links`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe('SCAN_NOT_FOUND');
    });
  });

  describe('DELETE /api/v1/projects/:projectId/share-links/:shareLinkId', () => {
    it('revokes a project share link as the owner', async () => {
      const response = await request(app)
        .delete(`/api/v1/projects/${PROJECT_ID}/share-links/${SHARE_LINK_ID}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const body = ShareLinkRevokeResponseSchema.parse(response.body as unknown);
      expect(body).toEqual({
        shareLinkId: SHARE_LINK_ID,
        status: 'REVOKED',
        revokedAt: NOW.toISOString(),
      });
      expect(revokeShareLink).toHaveBeenCalledWith(USER_OWNER, SHARE_LINK_ID);
    });

    it('rejects an unknown share link with 404', async () => {
      revokeShareLink.mockRejectedValue(new ShareLinkNotFoundError());

      const response = await request(app)
        .delete(`/api/v1/projects/${PROJECT_ID}/share-links/${SHARE_LINK_ID}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe(
        'SHARE_LINK_NOT_FOUND',
      );
    });

    it('rejects a non-owner with 403', async () => {
      revokeShareLink.mockRejectedValue(new NotOwnerError());

      const response = await request(app)
        .delete(`/api/v1/projects/${PROJECT_ID}/share-links/${SHARE_LINK_ID}`)
        .set('Authorization', `Bearer ${recipientToken}`)
        .expect(403);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe('NOT_OWNER');
    });

    it('rejects a share link whose owning project is deleted with 404', async () => {
      revokeShareLink.mockRejectedValue(new ProjectNotFoundError());

      const response = await request(app)
        .delete(`/api/v1/projects/${PROJECT_ID}/share-links/${SHARE_LINK_ID}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe(
        'PROJECT_NOT_FOUND',
      );
    });
  });

  describe('DELETE /api/v1/scans/:scanId/share-links/:shareLinkId', () => {
    it('revokes a scan share link as the owner', async () => {
      await request(app)
        .delete(`/api/v1/scans/${SCAN_ID}/share-links/${SHARE_LINK_ID}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(revokeShareLink).toHaveBeenCalledWith(USER_OWNER, SHARE_LINK_ID);
    });

    it('rejects a share link whose owning scan is deleted with 404', async () => {
      revokeShareLink.mockRejectedValue(new ScanNotFoundError());

      const response = await request(app)
        .delete(`/api/v1/scans/${SCAN_ID}/share-links/${SHARE_LINK_ID}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe('SCAN_NOT_FOUND');
    });
  });
});
