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
import { ScanNotFoundError } from '../src/modules/scan/scan.errors.js';
import {
  NotSharedScanError,
  SharedScanNotInListError,
} from '../src/modules/shared-scans/shared-scans.errors.js';
import {
  SharedScanListResponseSchema,
  SharedScanRemoveResponseSchema,
  SharedScanResponseSchema,
} from '../src/modules/shared-scans/shared-scans.schemas.js';
import type { SharedScansService } from '../src/modules/shared-scans/shared-scans.service.js';
import type { NoteService } from '../src/modules/note/note.service.js';
import type { ProjectService } from '../src/modules/project/project.service.js';
import type { ScanService } from '../src/modules/scan/scan.service.js';
import type { ScanAssetService } from '../src/modules/scan-asset/scan-asset.service.js';
import type { ShareService } from '../src/modules/share/share.service.js';
import type { ShareLinkService } from '../src/modules/share/share-link.service.js';
import type { SharedProjectsService } from '../src/modules/shared-projects/shared-projects.service.js';

const ACCESS_SECRET = 'access-secret-that-is-at-least-32-characters';
const USER_VIEWER = 'f1a2b3c4-d5e6-7890-abcd-ef1234567890';
const USER_OWNER = 'eb5d278f-c857-45c7-887d-7be65288cb75';
const SCAN_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const PROJECT_ID = '11111111-2222-4333-8444-555555555555';
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

describe('Shared With Me scan HTTP endpoints', () => {
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
        email: userId === USER_OWNER ? 'owner@example.com' : 'viewer@example.com',
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
  const sharedProjectsService = {
    list: vi.fn(),
    detail: vi.fn(),
    remove: vi.fn(),
  } as unknown as SharedProjectsService;
  const list = vi.fn<SharedScansService['list']>();
  const detail = vi.fn<SharedScansService['detail']>();
  const remove = vi.fn<SharedScansService['remove']>();
  const sharedScansService = {
    list,
    detail,
    remove,
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

  let viewerToken: string;
  let ownerToken: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    viewerToken = await signAccessToken(USER_VIEWER);
    ownerToken = await signAccessToken(USER_OWNER);
    list.mockResolvedValue({
      items: [
        {
          id: SCAN_ID,
          projectId: PROJECT_ID,
          name: 'Living Room Scan',
          description: null,
          thumbnail: null,
          creator: { id: USER_OWNER, email: 'owner@example.com' },
          noteCount: 2,
          assetStatus: 'UPLOADED',
          syncStatus: 'SYNCED',
          modelVersion: 1,
          updatedAt: NOW.toISOString(),
          status: 'ACTIVE',
          permissions: { role: 'VIEWER', canView: true, canEdit: false, canDelete: false },
        },
      ],
      pagination: { page: 1, limit: 5, total: 1, totalPages: 1 },
    });
    detail.mockResolvedValue({
      id: SCAN_ID,
      projectId: PROJECT_ID,
      name: 'Living Room Scan',
      description: null,
      thumbnail: null,
      creator: { id: USER_OWNER, email: 'owner@example.com' },
      noteCount: 2,
      assetStatus: 'UPLOADED',
      syncStatus: 'SYNCED',
      modelVersion: 1,
      updatedAt: NOW.toISOString(),
      status: 'ACTIVE',
      permissions: { role: 'VIEWER', canView: true, canEdit: false, canDelete: false },
    });
    remove.mockResolvedValue({ scanId: SCAN_ID, removedAt: NOW.toISOString() });
  });

  describe('GET /api/v1/shared-scans', () => {
    it('lists scans shared with the current user', async () => {
      const response = await request(app)
        .get('/api/v1/shared-scans')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);

      const body = SharedScanListResponseSchema.parse(response.body as unknown);
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
        .get('/api/v1/shared-scans?search=living&page=2&limit=10&sort=name:asc')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);

      expect(list).toHaveBeenCalledWith(USER_VIEWER, {
        search: 'living',
        page: 2,
        limit: 10,
        sort: 'name:asc',
      });
    });

    it('rejects an unauthenticated request with 401', async () => {
      const response = await request(app).get('/api/v1/shared-scans').expect(401);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe('UNAUTHORIZED');
      expect(list).not.toHaveBeenCalled();
    });

    it('rejects invalid query parameters with 400', async () => {
      const response = await request(app)
        .get('/api/v1/shared-scans?limit=0&sort=unknown:desc')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(400);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe(
        'VALIDATION_ERROR',
      );
      expect(list).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/shared-scans/:scanId', () => {
    it('returns an active shared scan', async () => {
      const response = await request(app)
        .get(`/api/v1/shared-scans/${SCAN_ID}`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);

      const body = SharedScanResponseSchema.parse(response.body as unknown);
      expect(body.id).toBe(SCAN_ID);
      expect(body.status).toBe('ACTIVE');
      expect(detail).toHaveBeenCalledWith(USER_VIEWER, SCAN_ID);
    });

    it('hides revoked, deleted, and no-access scans behind 404', async () => {
      detail.mockRejectedValue(new ScanNotFoundError());

      const response = await request(app)
        .get(`/api/v1/shared-scans/${SCAN_ID}`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(404);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe('SCAN_NOT_FOUND');
    });

    it('rejects an unauthenticated request with 401', async () => {
      const response = await request(app).get(`/api/v1/shared-scans/${SCAN_ID}`).expect(401);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe('UNAUTHORIZED');
      expect(detail).not.toHaveBeenCalled();
    });

    it('rejects a malformed scan id with 400', async () => {
      const response = await request(app)
        .get('/api/v1/shared-scans/not-a-uuid')
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(400);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe(
        'VALIDATION_ERROR',
      );
      expect(detail).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/v1/shared-scans/:scanId', () => {
    it('removes a scan from Shared With Me', async () => {
      const response = await request(app)
        .delete(`/api/v1/shared-scans/${SCAN_ID}`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);

      const body = SharedScanRemoveResponseSchema.parse(response.body as unknown);
      expect(body).toEqual({ scanId: SCAN_ID, removedAt: NOW.toISOString() });
      expect(remove).toHaveBeenCalledWith(USER_VIEWER, SCAN_ID);
    });

    it('rejects the owner with 403', async () => {
      remove.mockRejectedValue(new NotSharedScanError());

      const response = await request(app)
        .delete(`/api/v1/shared-scans/${SCAN_ID}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(403);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe(
        'NOT_SHARED_SCAN',
      );
    });

    it('rejects a scan that is not in Shared With Me with 409', async () => {
      remove.mockRejectedValue(new SharedScanNotInListError());

      const response = await request(app)
        .delete(`/api/v1/shared-scans/${SCAN_ID}`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(409);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe(
        'NOT_IN_SHARED_WITH_ME',
      );
    });

    it('rejects an unauthenticated request with 401', async () => {
      const response = await request(app).delete(`/api/v1/shared-scans/${SCAN_ID}`).expect(401);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe('UNAUTHORIZED');
      expect(remove).not.toHaveBeenCalled();
    });
  });
});
