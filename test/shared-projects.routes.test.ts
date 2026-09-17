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
import {
  NotSharedProjectError,
  SharedProjectNotInListError,
} from '../src/modules/shared-projects/shared-projects.errors.js';
import {
  SharedProjectDetailResponseSchema,
  SharedProjectListResponseSchema,
  SharedProjectRemoveResponseSchema,
} from '../src/modules/shared-projects/shared-projects.schemas.js';
import type { SharedProjectsService } from '../src/modules/shared-projects/shared-projects.service.js';
import type { SharedScansService } from '../src/modules/shared-scans/shared-scans.service.js';
import type { SyncService } from '../src/modules/sync/sync.service.js';
import type { UserProfileService } from '../src/modules/users/users.types.js';
import type { NoteService } from '../src/modules/note/note.service.js';
import type { ProjectService } from '../src/modules/project/project.service.js';
import type { ScanService } from '../src/modules/scan/scan.service.js';
import type { ScanAssetService } from '../src/modules/scan-asset/scan-asset.service.js';
import type { ShareService } from '../src/modules/share/share.service.js';
import type { ShareLinkService } from '../src/modules/share/share-link.service.js';

const ACCESS_SECRET = 'access-secret-that-is-at-least-32-characters';
const USER_VIEWER = 'f1a2b3c4-d5e6-7890-abcd-ef1234567890';
const USER_OWNER = 'eb5d278f-c857-45c7-887d-7be65288cb75';
const PROJECT_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
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
  invitationCreateRateLimitWindowSeconds: 900,
  invitationCreateRateLimitMaxRequests: 20,
  invitationAcceptRateLimitWindowSeconds: 300,
  invitationAcceptRateLimitMaxRequests: 30,
  uploadSessionCreateRateLimitWindowSeconds: 900,
  uploadSessionCreateRateLimitMaxRequests: 30,
  downloadUrlRateLimitWindowSeconds: 300,
  downloadUrlRateLimitMaxRequests: 60,
  appleClientId: 'com.example.roomscan',
  accessTokenSecret: ACCESS_SECRET,
  refreshTokenSecret: 'refresh-secret-that-is-at-least-32-characters',
  syncCryptoKey: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
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
  storagePublicEndpoint: '',
  storagePublicUseSsl: false,
  storageUploadUrlTtlSeconds: 900,
  storageDownloadUrlTtlSeconds: 60,
  assetMinModelSizeBytes: 10_000_000,
  assetMaxModelSizeBytes: 500_000_000,
  assetMaxThumbnailSizeBytes: 10_000_000,
  invitationTtlSeconds: 604_800,
  invitationBaseUrl: 'https://invite.roomscan.dev',
  uploadSessionExpiryGraceSeconds: 300,
  orphanAssetCleanupBatchSize: 200,
  mailProvider: 'log',
  smtpHost: '',
  smtpPort: 2525,
  smtpUser: '',
  smtpPass: '',
  smtpSecure: false,
  mailFrom: 'RoomScan App <notifications@roomscan.app>',
};

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

describe('Shared With Me HTTP endpoints', () => {
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
        publicUserId: 'GP5HS2WKBE',
        email: userId === USER_OWNER ? 'owner@example.com' : 'viewer@example.com',
        displayName: null,
      }),
    ),
    updateDisplayName: vi.fn(),
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
  const shareService = {
    createInvitation: vi.fn(),
    previewInvitation: vi.fn(),
    acceptInvitation: vi.fn(),
    declineInvitation: vi.fn(),
    revokeInvitation: vi.fn(),
    resendInvitation: vi.fn(),
    listShares: vi.fn(),
    revokeViewer: vi.fn(),
  } as unknown as ShareService;
  const shareLinkService = {
    createShareLink: vi.fn(),
    listShareLinks: vi.fn(),
    revokeShareLink: vi.fn(),
  } as unknown as ShareLinkService;
  const list = vi.fn<SharedProjectsService['list']>();
  const detail = vi.fn<SharedProjectsService['detail']>();
  const remove = vi.fn<SharedProjectsService['remove']>();
  const sharedProjectsService = {
    list,
    detail,
    remove,
  } as unknown as SharedProjectsService;
  const sharedScansService = {
    list: vi.fn(),
    detail: vi.fn(),
    remove: vi.fn(),
  } as unknown as SharedScansService;
  const syncService = {
    getChanges: vi.fn(),
    getStatus: vi.fn(),
  } as unknown as SyncService;
  const userProfileService = {
    updateMe: vi.fn(),
  } as unknown as UserProfileService;
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
    syncService,
    userProfileService,
    accessTokenVerifier,
    currentUserRepository,
    rateLimiters,
    clock: () => NOW,
  });

  let viewerToken: string;
  let ownerToken: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    viewerToken = await signAccessToken(USER_VIEWER);
    ownerToken = await signAccessToken(USER_OWNER);
    list.mockResolvedValue({
      items: [
        {
          id: PROJECT_ID,
          name: 'District 2 Apartment',
          description: null,
          owner: { id: USER_OWNER, email: 'owner@example.com', displayName: null },
          scanCount: 2,
          thumbnail: null,
          updatedAt: NOW.toISOString(),
          status: 'ACTIVE',
          permissions: {
            role: 'VIEWER',
            canView: true,
            canEdit: false,
            canDelete: false,
            canShare: false,
            canCreateScan: false,
          },
        },
      ],
      pagination: { page: 1, limit: 5, total: 1, totalPages: 1 },
    });
    detail.mockResolvedValue({
      id: PROJECT_ID,
      name: 'District 2 Apartment',
      description: null,
      owner: { id: USER_OWNER, email: 'owner@example.com', displayName: null },
      scanCount: 2,
      thumbnail: null,
      updatedAt: NOW.toISOString(),
      status: 'ACTIVE',
      scans: [
        {
          id: 'f1e2d3c4-a5b6-7890-abcd-ef1234567890',
          name: 'Living Room',
          description: null,
          thumbnail: null,
          noteCount: 3,
          assetStatus: 'UPLOADED',
          syncStatus: 'SYNCED',
          createdAt: NOW.toISOString(),
        },
      ],
      permissions: {
        role: 'VIEWER',
        canView: true,
        canEdit: false,
        canDelete: false,
        canShare: false,
        canCreateScan: false,
      },
    });
    remove.mockResolvedValue({ projectId: PROJECT_ID, removedAt: NOW.toISOString() });
  });

  describe('GET /api/v1/shared-projects', () => {
    it('lists projects shared with the current user', async () => {
      const response = await request(app)
        .get('/api/v1/shared-projects')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);

      const body = SharedProjectListResponseSchema.parse(response.body as unknown);
      expect(body.items).toHaveLength(1);
      expect(body.items[0]?.status).toBe('ACTIVE');
      expect(body.items[0]?.permissions.role).toBe('VIEWER');
      expect(list).toHaveBeenCalledWith(USER_VIEWER, {
        page: 1,
        limit: 5,
        sort: 'updatedAt:desc',
      });
    });

    it('forwards search and pagination query parameters', async () => {
      await request(app)
        .get('/api/v1/shared-projects?search=garden&page=2&limit=10&sort=name:asc')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);

      expect(list).toHaveBeenCalledWith(USER_VIEWER, {
        search: 'garden',
        page: 2,
        limit: 10,
        sort: 'name:asc',
      });
    });

    it('rejects an unauthenticated request with 401', async () => {
      const response = await request(app).get('/api/v1/shared-projects').expect(401);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe('UNAUTHORIZED');
      expect(list).not.toHaveBeenCalled();
    });

    it('rejects invalid query parameters with 400', async () => {
      const response = await request(app)
        .get('/api/v1/shared-projects?limit=0&sort=unknown:desc')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(400);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe(
        'VALIDATION_ERROR',
      );
      expect(list).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/shared-projects/:projectId', () => {
    it('returns an active shared project', async () => {
      const response = await request(app)
        .get(`/api/v1/shared-projects/${PROJECT_ID}`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);

      const body = SharedProjectDetailResponseSchema.parse(response.body as unknown);
      expect(body.id).toBe(PROJECT_ID);
      expect(body.status).toBe('ACTIVE');
      expect(body.scans).toHaveLength(1);
      expect(detail).toHaveBeenCalledWith(USER_VIEWER, PROJECT_ID);
    });

    it('hides revoked, deleted, and no-access projects behind 404', async () => {
      detail.mockRejectedValue(new ProjectNotFoundError());

      const response = await request(app)
        .get(`/api/v1/shared-projects/${PROJECT_ID}`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(404);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe(
        'PROJECT_NOT_FOUND',
      );
    });

    it('rejects an unauthenticated request with 401', async () => {
      const response = await request(app).get(`/api/v1/shared-projects/${PROJECT_ID}`).expect(401);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe('UNAUTHORIZED');
      expect(detail).not.toHaveBeenCalled();
    });

    it('rejects a malformed project id with 400', async () => {
      const response = await request(app)
        .get('/api/v1/shared-projects/not-a-uuid')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(400);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe(
        'VALIDATION_ERROR',
      );
      expect(detail).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/v1/shared-projects/:projectId', () => {
    it('removes a project from Shared With Me', async () => {
      const response = await request(app)
        .delete(`/api/v1/shared-projects/${PROJECT_ID}`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);

      const body = SharedProjectRemoveResponseSchema.parse(response.body as unknown);
      expect(body).toEqual({ projectId: PROJECT_ID, removedAt: NOW.toISOString() });
      expect(remove).toHaveBeenCalledWith(USER_VIEWER, PROJECT_ID);
    });

    it('rejects the owner with 403', async () => {
      remove.mockRejectedValue(new NotSharedProjectError());

      const response = await request(app)
        .delete(`/api/v1/shared-projects/${PROJECT_ID}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(403);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe(
        'NOT_SHARED_PROJECT',
      );
    });

    it('rejects a project that is not in Shared With Me with 409', async () => {
      remove.mockRejectedValue(new SharedProjectNotInListError());

      const response = await request(app)
        .delete(`/api/v1/shared-projects/${PROJECT_ID}`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(409);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe(
        'NOT_IN_SHARED_WITH_ME',
      );
    });

    it('rejects an unauthenticated request with 401', async () => {
      const response = await request(app)
        .delete(`/api/v1/shared-projects/${PROJECT_ID}`)
        .expect(401);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe('UNAUTHORIZED');
      expect(remove).not.toHaveBeenCalled();
    });
  });

  describe('error envelope', () => {
    it('returns a request ID with shared-projects errors', async () => {
      remove.mockRejectedValue(new SharedProjectNotInListError());

      const response = await request(app)
        .delete(`/api/v1/shared-projects/${PROJECT_ID}`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(409);

      const body = ErrorResponseSchema.parse(response.body as unknown);
      expect(response.headers['x-request-id']).toEqual(expect.any(String));
      expect(body.requestId).toBe(response.headers['x-request-id']);
    });
  });
});
