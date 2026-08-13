import type { RequestHandler } from 'express';
import { SignJWT, jwtVerify } from 'jose';
import pino from 'pino';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import type { SyncService } from '../src/modules/sync/sync.service.js';
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
import {
  InvitationAcceptResponseSchema,
  InvitationCreateResponseSchema,
  InvitationDeclineResponseSchema,
  InvitationPreviewResponseSchema,
  InvitationResendResponseSchema,
  InvitationRevokeResponseSchema,
  SharesListResponseSchema,
  ViewerRevokeResponseSchema,
} from '../src/modules/share/share.schemas.js';
import type { ShareService } from '../src/modules/share/share.service.js';
import type { SharedProjectsService } from '../src/modules/shared-projects/shared-projects.service.js';
import type { NoteService } from '../src/modules/note/note.service.js';
import type { ProjectService } from '../src/modules/project/project.service.js';
import type { ScanService } from '../src/modules/scan/scan.service.js';
import type { ScanAssetService } from '../src/modules/scan-asset/scan-asset.service.js';

const ACCESS_SECRET = 'access-secret-that-is-at-least-32-characters';
const USER_OWNER = 'eb5d278f-c857-45c7-887d-7be65288cb75';
const USER_RECIPIENT = 'f1a2b3c4-d5e6-7890-abcd-ef1234567890';
const PROJECT_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const INVITATION_ID = 'b1a2c3d4-e5f6-4890-abcd-ef1234567890';
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
  idempotencyKeyTtlSeconds: 86_400,
  invitationBaseUrl: 'https://invite.roomscan.dev',
  mailProvider: 'log',
  smtpHost: '',
  smtpPort: 2525,
  smtpUser: '',
  smtpPass: '',
  smtpSecure: false,
  mailFrom: 'RoomScan App <notifications@roomscan.app>',
};

const invitationUrl = `https://invite.roomscan.dev/invitations/${TOKEN}`;
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
  const previewInvitation = vi.fn<ShareService['previewInvitation']>();
  const acceptInvitation = vi.fn<ShareService['acceptInvitation']>();
  const declineInvitation = vi.fn<ShareService['declineInvitation']>();
  const revokeInvitation = vi.fn<ShareService['revokeInvitation']>();
  const resendInvitation = vi.fn<ShareService['resendInvitation']>();
  const listShares = vi.fn<ShareService['listShares']>();
  const revokeViewer = vi.fn<ShareService['revokeViewer']>();
  const shareService = {
    createInvitation,
    previewInvitation,
    acceptInvitation,
    declineInvitation,
    revokeInvitation,
    resendInvitation,
    listShares,
    revokeViewer,
  } as unknown as ShareService;
  const sharedProjectsService = {
    list: vi.fn(),
    detail: vi.fn(),
    remove: vi.fn(),
  } as unknown as SharedProjectsService;
  const syncService = {
    listChanges: vi.fn(),
    listStatus: vi.fn(),
    getProjectStatus: vi.fn(),
  } as unknown as SyncService;
  const idempotencyMiddleware: RequestHandler = (_request, _response, next) => next();
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
    sharedProjectsService,
    syncService,
    idempotencyMiddleware,
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
      project: {
        id: PROJECT_ID,
        name: 'District 2 Apartment',
        description: null,
        thumbnail: null,
      },
      status: 'PENDING',
      recipientEmail: RECIPIENT_EMAIL,
      sentAt: NOW.toISOString(),
      expiresAt,
    });
    acceptInvitation.mockResolvedValue({
      invitationId: INVITATION_ID,
      project: {
        id: PROJECT_ID,
        name: 'District 2 Apartment',
        description: null,
        thumbnail: null,
        owner: { id: USER_OWNER, email: 'owner@example.com' },
      },
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
    it('previews a valid invitation anonymously', async () => {
      const response = await request(app).get(`/api/v1/invitations/${TOKEN}`).expect(200);

      const body = InvitationPreviewResponseSchema.parse(response.body as unknown);
      expect(body).toEqual({
        project: {
          id: PROJECT_ID,
          name: 'District 2 Apartment',
          description: null,
          thumbnail: null,
        },
        status: 'PENDING',
        recipientEmail: RECIPIENT_EMAIL,
        sentAt: NOW.toISOString(),
        expiresAt,
      });
      expect(previewInvitation).toHaveBeenCalledWith(TOKEN, undefined);
    });

    it('reports hasAccess when a valid token is supplied', async () => {
      previewInvitation.mockResolvedValue({
        project: {
          id: PROJECT_ID,
          name: 'District 2 Apartment',
          description: null,
          thumbnail: null,
        },
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
      expect(previewInvitation).toHaveBeenCalledWith(TOKEN, USER_RECIPIENT);
    });

    it('returns 404 for an unknown token', async () => {
      previewInvitation.mockRejectedValue(new InvitationNotFoundError());

      const response = await request(app).get(`/api/v1/invitations/${TOKEN}`).expect(404);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe(
        'INVITATION_NOT_FOUND',
      );
    });

    it('returns 400 for a malformed token', async () => {
      const response = await request(app).get('/api/v1/invitations/not-a-valid-token').expect(400);

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
        invitationId: INVITATION_ID,
        project: {
          id: PROJECT_ID,
          name: 'District 2 Apartment',
          description: null,
          thumbnail: null,
          owner: { id: USER_OWNER, email: 'owner@example.com' },
        },
        access: { role: 'VIEWER', status: 'ACTIVE', grantedAt: NOW.toISOString() },
      });
      expect(acceptInvitation).toHaveBeenCalledWith(USER_RECIPIENT, TOKEN);
    });

    it('rejects an unauthenticated accept with 401', async () => {
      const response = await request(app).post(`/api/v1/invitations/${TOKEN}/accept`).expect(401);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe('UNAUTHORIZED');
      expect(acceptInvitation).not.toHaveBeenCalled();
    });

    it.each([
      ['unknown token', new InvitationNotFoundError(), 404, 'INVITATION_NOT_FOUND'],
      ['expired invitation', new InvitationExpiredError(), 409, 'INVITATION_EXPIRED'],
      ['revoked invitation', new InvitationRevokedError(), 409, 'INVITATION_REVOKED'],
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
      expect(declineInvitation).toHaveBeenCalledWith(USER_RECIPIENT, TOKEN);
    });

    it('rejects an unauthenticated decline with 401', async () => {
      const response = await request(app).post(`/api/v1/invitations/${TOKEN}/decline`).expect(401);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe('UNAUTHORIZED');
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
      acceptInvitation.mockRejectedValue(new InvitationRevokedError());

      const response = await request(app)
        .post(`/api/v1/invitations/${TOKEN}/accept`)
        .set('Authorization', `Bearer ${recipientToken}`)
        .expect(409);

      const body = ErrorResponseSchema.parse(response.body as unknown);
      expect(response.headers['x-request-id']).toEqual(expect.any(String));
      expect(body.requestId).toBe(response.headers['x-request-id']);
    });
  });
});
