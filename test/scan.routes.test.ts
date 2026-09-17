import { SignJWT, jwtVerify } from 'jose';
import pino from 'pino';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

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
  CreateScanResponseSchema,
  ScanListResponseSchema,
  ScanResponseSchema,
} from '../src/modules/scan/scan.schemas.js';
import type { ScanService } from '../src/modules/scan/scan.service.js';
import type { ScanResult } from '../src/modules/scan/scan.types.js';
import type { ScanAssetService } from '../src/modules/scan-asset/scan-asset.service.js';
import type { NoteService } from '../src/modules/note/note.service.js';
import type { ShareService } from '../src/modules/share/share.service.js';
import type { ShareLinkService } from '../src/modules/share/share-link.service.js';
import type { SharedProjectsService } from '../src/modules/shared-projects/shared-projects.service.js';
import type { SharedScansService } from '../src/modules/shared-scans/shared-scans.service.js';
import type { SyncService } from '../src/modules/sync/sync.service.js';
import type { UserProfileService } from '../src/modules/users/users.types.js';
import type { ProjectService } from '../src/modules/project/project.service.js';

const ACCESS_SECRET = 'access-secret-that-is-at-least-32-characters';
const USER_A = 'eb5d278f-c857-45c7-887d-7be65288cb75';
const USER_B = 'f1a2b3c4-d5e6-7890-abcd-ef1234567890';
const PROJECT_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const SCAN_ID = 'f1e2d3c4-a5b6-7890-abcd-ef1234567890';
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
  invitationBaseUrl: 'http://localhost:3000',
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

function scanResult(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    id: SCAN_ID,
    projectId: PROJECT_ID,
    name: 'Living Room',
    description: null,
    thumbnail: null,
    creator: {
      id: USER_A,
      email: 'owner@example.com',
      displayName: null,
    },
    noteCount: 0,
    assetStatus: 'NONE',
    syncStatus: 'PENDING',
    modelVersion: 1,
    revision: 1,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    permissions: {
      role: 'OWNER',
      canView: true,
      canEdit: true,
      canDelete: true,
    },
    ...overrides,
  };
}

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

describe('Scan HTTP endpoints', () => {
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
  const findCurrentUser = vi.fn<CurrentUserRepository['findById']>().mockImplementation((userId) =>
    Promise.resolve({
      id: userId,
      publicUserId: 'GP5HS2WKBE',
      email: userId === USER_A ? 'owner@example.com' : 'viewer@example.com',
      displayName: null,
    }),
  );
  const currentUserRepository: CurrentUserRepository = {
    findById: findCurrentUser,
    updateDisplayName: vi.fn(),
  };
  const projectService = {
    create: vi.fn(),
    list: vi.fn(),
    getById: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  } as unknown as ProjectService;
  const create = vi.fn<ScanService['create']>();
  const createWithUploadsIdempotently = vi.fn<ScanService['createWithUploadsIdempotently']>();
  const list = vi.fn<ScanService['list']>();
  const getById = vi.fn<ScanService['getById']>();
  const update = vi.fn<ScanService['update']>();
  const remove = vi.fn<ScanService['delete']>();
  const scanService = {
    create,
    createWithUploadsIdempotently,
    list,
    getById,
    update,
    delete: remove,
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

  let tokenA: string;
  let tokenB: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tokenA = await signAccessToken(USER_A);
    tokenB = await signAccessToken(USER_B);
    create.mockResolvedValue({ scan: scanResult(), created: true });
    createWithUploadsIdempotently.mockImplementation(
      (
        _userId: string,
        _projectId: string,
        _data: { name: string; description: string | null; clientMutationId?: string },
        uploads: { assetType: 'THUMBNAIL' | 'MODEL' }[],
      ) => {
        const scan = scanResult();
        const uploadResponse = {
          uploadSessionId: 'c0ffee00-0000-4000-8000-000000000099',
          assetId: 'c0ffee00-0000-4000-8000-000000000099',
          uploadUrl: 'http://storage/upload/url',
          uploadUrlExpiresAt: NOW.toISOString(),
        };
        const uploadsMap: { thumbnail?: typeof uploadResponse; scanFile?: typeof uploadResponse } =
          {};
        for (const upload of uploads) {
          if (upload.assetType === 'THUMBNAIL') {
            uploadsMap.thumbnail = uploadResponse;
          } else {
            uploadsMap.scanFile = uploadResponse;
          }
        }
        const result: Record<string, unknown> = {
          ...scan,
          ...(uploads.length > 0 ? { uploads: uploadsMap } : {}),
        };
        return Promise.resolve({
          body: result as never,
          statusCode: 201,
          replayed: false,
        });
      },
    );
    list.mockResolvedValue({
      items: [scanResult()],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    getById.mockResolvedValue(scanResult());
    update.mockResolvedValue(scanResult({ name: 'Updated Room' }));
    remove.mockResolvedValue(1);
  });

  describe('POST /api/v1/projects/:projectId/scans', () => {
    it('creates a scan and returns 201', async () => {
      const response = await request(app)
        .post(`/api/v1/projects/${PROJECT_ID}/scans`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('Idempotency-Key', 'scan-create-1')
        .send({ name: 'Living Room' })
        .expect(201);
      const body = ScanResponseSchema.parse(response.body as unknown);

      expect(body).toMatchObject(scanResult());
      expect(createWithUploadsIdempotently).toHaveBeenCalledWith(
        USER_A,
        PROJECT_ID,
        { name: 'Living Room', description: null },
        [],
        'scan-create-1',
        { name: 'Living Room', description: null },
      );
    });

    it('mints thumbnail and scan-file upload URLs from the create payload', async () => {
      const response = await request(app)
        .post(`/api/v1/projects/${PROJECT_ID}/scans`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('Idempotency-Key', 'scan-create-with-assets')
        .send({
          name: 'Living Room',
          thumbnail: { contentType: 'image/png', sizeBytes: 2048 },
          scanFile: {
            contentType: 'model/usdz',
            sizeBytes: 20_000_000,
            checksum: 'abc-checksum',
            modelVersion: '1',
          },
        })
        .expect(201);

      const body = CreateScanResponseSchema.parse(response.body as unknown);
      expect(body.uploads?.thumbnail?.uploadUrl).toBe('http://storage/upload/url');
      expect(body.uploads?.scanFile?.uploadUrl).toBe('http://storage/upload/url');
      expect(createWithUploadsIdempotently).toHaveBeenCalledWith(
        USER_A,
        PROJECT_ID,
        { name: 'Living Room', description: null },
        [
          {
            assetType: 'THUMBNAIL',
            contentType: 'image/png',
            sizeBytes: 2048,
          },
          {
            assetType: 'MODEL',
            contentType: 'model/usdz',
            sizeBytes: 20_000_000,
            checksum: 'abc-checksum',
            modelVersion: '1',
          },
        ],
        'scan-create-with-assets',
        {
          name: 'Living Room',
          description: null,
          thumbnail: { contentType: 'image/png', sizeBytes: 2048 },
          scanFile: {
            contentType: 'model/usdz',
            sizeBytes: 20_000_000,
            checksum: 'abc-checksum',
            modelVersion: '1',
          },
        },
      );
    });

    it('rejects an invalid upload descriptor in the create payload', async () => {
      await request(app)
        .post(`/api/v1/projects/${PROJECT_ID}/scans`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Living Room',
          scanFile: { contentType: 'text/plain', sizeBytes: 20_000_000 },
        })
        .expect(400);
    });

    it('returns 200 for an idempotent repeat create', async () => {
      createWithUploadsIdempotently.mockResolvedValueOnce({
        body: scanResult(),
        statusCode: 200,
        replayed: true,
      });

      const response = await request(app)
        .post(`/api/v1/projects/${PROJECT_ID}/scans`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('Idempotency-Key', 'mutation-abc')
        .send({ name: 'Living Room', clientMutationId: 'mutation-abc' })
        .expect(200);
      const body = ScanResponseSchema.parse(response.body as unknown);

      expect(body.name).toBe('Living Room');
    });

    it('rejects blank name', async () => {
      await request(app)
        .post(`/api/v1/projects/${PROJECT_ID}/scans`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: '   ' })
        .expect(400);
    });

    it('rejects missing name', async () => {
      await request(app)
        .post(`/api/v1/projects/${PROJECT_ID}/scans`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({})
        .expect(400);
    });

    it('rejects long name', async () => {
      await request(app)
        .post(`/api/v1/projects/${PROJECT_ID}/scans`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'x'.repeat(101) })
        .expect(400);
    });

    it('rejects long description', async () => {
      await request(app)
        .post(`/api/v1/projects/${PROJECT_ID}/scans`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Living Room', description: 'y'.repeat(501) })
        .expect(400);
    });

    it('rejects unknown fields', async () => {
      await request(app)
        .post(`/api/v1/projects/${PROJECT_ID}/scans`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Living Room', ownerId: USER_A })
        .expect(400);
    });

    it('requires a valid token for an existing current user', async () => {
      await request(app)
        .post(`/api/v1/projects/${PROJECT_ID}/scans`)
        .send({ name: 'Living Room' })
        .expect(401);

      findCurrentUser.mockResolvedValueOnce(null);
      await request(app)
        .post(`/api/v1/projects/${PROJECT_ID}/scans`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Living Room' })
        .expect(401);
    });

    it('hides create from a Viewer', async () => {
      createWithUploadsIdempotently.mockRejectedValueOnce(new ScanNotFoundError());

      const response = await request(app)
        .post(`/api/v1/projects/${PROJECT_ID}/scans`)
        .set('Authorization', `Bearer ${tokenB}`)
        .set('Idempotency-Key', 'scan-create-viewer')
        .send({ name: 'Living Room' })
        .expect(404);
      const body = ErrorResponseSchema.parse(response.body as unknown);

      expect(body.error.code).toBe('SCAN_NOT_FOUND');
    });

    it('returns a safe 500 for unexpected errors', async () => {
      createWithUploadsIdempotently.mockRejectedValueOnce(new Error('secret=do-not-expose'));

      const response = await request(app)
        .post(`/api/v1/projects/${PROJECT_ID}/scans`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('Idempotency-Key', 'scan-create-error')
        .send({ name: 'Living Room' })
        .expect(500);
      const body = ErrorResponseSchema.parse(response.body as unknown);

      expect(body.error.code).toBe('INTERNAL_SERVER_ERROR');
      expect(JSON.stringify(body)).not.toContain('do-not-expose');
    });
  });

  describe('GET /api/v1/projects/:projectId/scans', () => {
    it('returns a paginated scan list for the Owner', async () => {
      const response = await request(app)
        .get(`/api/v1/projects/${PROJECT_ID}/scans`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const body = ScanListResponseSchema.parse(response.body as unknown);

      expect(body.items).toHaveLength(1);
      expect(body.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      });
      expect(list).toHaveBeenCalledWith(USER_A, PROJECT_ID, {
        page: 1,
        limit: 20,
        sort: 'createdAt:desc',
      });
    });

    it('returns the list for an active Viewer', async () => {
      const response = await request(app)
        .get(`/api/v1/projects/${PROJECT_ID}/scans`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);
      const body = ScanListResponseSchema.parse(response.body as unknown);

      expect(body.items).toHaveLength(1);
      expect(list).toHaveBeenCalledWith(USER_B, PROJECT_ID, {
        page: 1,
        limit: 20,
        sort: 'createdAt:desc',
      });
    });

    it('passes page, limit, and sort', async () => {
      await request(app)
        .get(`/api/v1/projects/${PROJECT_ID}/scans?page=2&limit=10&sort=name:asc`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      expect(list).toHaveBeenCalledWith(USER_A, PROJECT_ID, {
        page: 2,
        limit: 10,
        sort: 'name:asc',
      });
    });

    it('rejects invalid list query', async () => {
      await request(app)
        .get(`/api/v1/projects/${PROJECT_ID}/scans?page=0`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(400);
    });

    it('hides list from a Viewer with no project access', async () => {
      list.mockRejectedValueOnce(new ScanNotFoundError());

      const response = await request(app)
        .get(`/api/v1/projects/${PROJECT_ID}/scans`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);
      const body = ErrorResponseSchema.parse(response.body as unknown);

      expect(body.error.code).toBe('SCAN_NOT_FOUND');
    });
  });

  describe('GET /api/v1/scans/:scanId', () => {
    it('returns scan detail for the Owner', async () => {
      const response = await request(app)
        .get(`/api/v1/scans/${SCAN_ID}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const body = ScanResponseSchema.parse(response.body as unknown);

      expect(body.permissions.role).toBe('OWNER');
      expect(getById).toHaveBeenCalledWith(USER_A, SCAN_ID);
    });

    it('returns scan detail for an active Viewer', async () => {
      getById.mockResolvedValueOnce(
        scanResult({
          permissions: { role: 'VIEWER', canView: true, canEdit: false, canDelete: false },
        }),
      );

      const response = await request(app)
        .get(`/api/v1/scans/${SCAN_ID}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);
      const body = ScanResponseSchema.parse(response.body as unknown);

      expect(body.permissions.role).toBe('VIEWER');
    });

    it('returns the same hidden 404 for missing, deleted, or inaccessible scans', async () => {
      getById.mockRejectedValueOnce(new ScanNotFoundError());

      const response = await request(app)
        .get(`/api/v1/scans/${SCAN_ID}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);
      const body = ErrorResponseSchema.parse(response.body as unknown);

      expect(body.error.code).toBe('SCAN_NOT_FOUND');
    });

    it('rejects an invalid scan UUID', async () => {
      await request(app)
        .get('/api/v1/scans/not-a-uuid')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(400);
    });
  });

  describe('PATCH /api/v1/scans/:scanId', () => {
    it('renames a scan as the Owner', async () => {
      const response = await request(app)
        .patch(`/api/v1/scans/${SCAN_ID}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('If-Match', '"1"')
        .send({ name: 'Updated Room' })
        .expect(200);
      const body = ScanResponseSchema.parse(response.body as unknown);

      expect(body.name).toBe('Updated Room');
      expect(update).toHaveBeenCalledWith(USER_A, SCAN_ID, 1, { name: 'Updated Room' });
    });

    it('clears description with null', async () => {
      await request(app)
        .patch(`/api/v1/scans/${SCAN_ID}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('If-Match', '"1"')
        .send({ description: null })
        .expect(200);
    });

    it('rejects empty partial update', async () => {
      await request(app)
        .patch(`/api/v1/scans/${SCAN_ID}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({})
        .expect(400);
    });

    it('rejects blank name', async () => {
      await request(app)
        .patch(`/api/v1/scans/${SCAN_ID}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: '   ' })
        .expect(400);
    });

    it('rejects long name', async () => {
      await request(app)
        .patch(`/api/v1/scans/${SCAN_ID}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'x'.repeat(101) })
        .expect(400);
    });

    it('rejects long description', async () => {
      await request(app)
        .patch(`/api/v1/scans/${SCAN_ID}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ description: 'y'.repeat(501) })
        .expect(400);
    });

    it('rejects unknown fields', async () => {
      await request(app)
        .patch(`/api/v1/scans/${SCAN_ID}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Updated', ownerId: USER_A })
        .expect(400);
    });

    it('hides update from a Viewer', async () => {
      update.mockRejectedValueOnce(new ScanNotFoundError());

      const response = await request(app)
        .patch(`/api/v1/scans/${SCAN_ID}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .set('If-Match', '"1"')
        .send({ name: 'Forbidden' })
        .expect(404);
      const body = ErrorResponseSchema.parse(response.body as unknown);

      expect(body.error.code).toBe('SCAN_NOT_FOUND');
    });

    it('returns safe 500 for unexpected errors', async () => {
      update.mockRejectedValueOnce(new Error('secret=do-not-expose'));

      const response = await request(app)
        .patch(`/api/v1/scans/${SCAN_ID}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('If-Match', '"1"')
        .send({ name: 'Updated' })
        .expect(500);
      const body = ErrorResponseSchema.parse(response.body as unknown);

      expect(body.error.code).toBe('INTERNAL_SERVER_ERROR');
      expect(JSON.stringify(body)).not.toContain('do-not-expose');
    });
  });

  describe('DELETE /api/v1/scans/:scanId', () => {
    it('returns 204 for the initial and repeated Owner deletion', async () => {
      await request(app)
        .delete(`/api/v1/scans/${SCAN_ID}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('If-Match', '"1"')
        .expect(204);
      await request(app)
        .delete(`/api/v1/scans/${SCAN_ID}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('If-Match', '"1"')
        .expect(204);

      expect(remove).toHaveBeenCalledTimes(2);
      expect(remove).toHaveBeenLastCalledWith(USER_A, SCAN_ID, 1);
    });

    it('hides deletion from a Viewer or unrelated user', async () => {
      remove.mockRejectedValueOnce(new ScanNotFoundError());

      const response = await request(app)
        .delete(`/api/v1/scans/${SCAN_ID}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .set('If-Match', '"1"')
        .expect(404);
      const body = ErrorResponseSchema.parse(response.body as unknown);

      expect(body.error.code).toBe('SCAN_NOT_FOUND');
    });
  });

  describe('OpenAPI document', () => {
    it('documents all five scan operations and Bearer auth', async () => {
      const response = await request(app).get('/api-doc.json').expect(200);
      const body = z
        .object({
          paths: z.record(z.string(), z.unknown()),
          components: z.object({
            securitySchemes: z.record(z.string(), z.unknown()),
            schemas: z.record(z.string(), z.unknown()),
          }),
        })
        .parse(response.body as unknown);

      expect(body.paths).toHaveProperty('/api/v1/projects/{projectId}/scans');
      expect(body.paths).toHaveProperty('/api/v1/scans/{scanId}');
      expect(body.components.securitySchemes).toHaveProperty('BearerAuth');
      expect(JSON.stringify(body.paths['/api/v1/projects/{projectId}/scans'])).toContain('"page"');
      expect(JSON.stringify(body.components.schemas.ScanResponse)).toContain('"permissions"');
    });
  });
});
