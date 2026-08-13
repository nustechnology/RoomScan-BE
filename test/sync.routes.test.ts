import type { RequestHandler } from 'express';
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
import { TOKEN_AUDIENCE, TOKEN_ISSUER } from '../src/config/constants.js';
import type { AppConfig } from '../src/config/env.js';
import type { DatabaseHealth } from '../src/infrastructure/database/database.js';
import type { AppleAuthService, TokenRefreshService } from '../src/modules/auth/auth.types.js';
import type { NoteService } from '../src/modules/note/note.service.js';
import type { ProjectService } from '../src/modules/project/project.service.js';
import type { ScanAssetService } from '../src/modules/scan-asset/scan-asset.service.js';
import type { ScanService } from '../src/modules/scan/scan.service.js';
import type { ShareService } from '../src/modules/share/share.service.js';
import type { SharedProjectsService } from '../src/modules/shared-projects/shared-projects.service.js';
import { InvalidCursorError, SyncProjectNotFoundError } from '../src/modules/sync/sync.errors.js';
import {
  SyncChangesResponseSchema,
  SyncProjectStatusSchema,
  SyncStatusListResponseSchema,
} from '../src/modules/sync/sync.schemas.js';
import type { SyncService } from '../src/modules/sync/sync.service.js';

const ACCESS_SECRET = 'access-secret-that-is-at-least-32-characters';
const USER_A = 'eb5d278f-c857-45c7-887d-7be65288cb75';
const USER_B = 'f1a2b3c4-d5e6-7890-abcd-ef1234567890';
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
  invitationBaseUrl: 'http://localhost:3000',
  mailProvider: 'log',
  smtpHost: '',
  smtpPort: 2525,
  smtpUser: '',
  smtpPass: '',
  smtpSecure: false,
  mailFrom: 'RoomScan App <notifications@roomscan.app>',
};

function changeResult() {
  return {
    resourceType: 'project' as const,
    resourceId: PROJECT_ID,
    operation: 'CREATE' as const,
    revision: 1,
    syncStatus: null,
    changedAt: NOW.toISOString(),
    deletedAt: null,
    cursor: 'opaque-cursor-1',
  };
}

function statusResult() {
  return {
    projectId: PROJECT_ID,
    syncStatus: 'SYNCED' as const,
    pendingCount: 0,
    syncingCount: 0,
    failedCount: 0,
    conflictCount: 0,
    lastSyncedAt: NOW.toISOString(),
    requiredAssetsUploaded: true,
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

describe('Sync HTTP endpoints', () => {
  const database: DatabaseHealth = {
    checkConnection: vi.fn(() => Promise.resolve()),
    disconnect: vi.fn(() => Promise.resolve()),
  };
  const logger = pino({ enabled: false });
  const rateLimiters = createRateLimiters(config, logger);
  const authService: AppleAuthService = { signInWithApple: vi.fn() };
  const refreshTokenService: TokenRefreshService = { refresh: vi.fn() };
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
    findById: vi.fn((userId: string) => Promise.resolve({ id: userId, email: 'user@example.com' })),
  };
  const listChanges = vi.fn<SyncService['listChanges']>();
  const listStatus = vi.fn<SyncService['listStatus']>();
  const getProjectStatus = vi.fn<SyncService['getProjectStatus']>();
  const syncService = {
    listChanges,
    listStatus,
    getProjectStatus,
  } as unknown as SyncService;
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
    listShares: vi.fn(),
    revokeViewer: vi.fn(),
  } as unknown as ShareService;
  const sharedProjectsService = {
    list: vi.fn(),
    detail: vi.fn(),
    remove: vi.fn(),
  } as unknown as SharedProjectsService;
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

  let tokenA: string;
  let tokenB: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tokenA = await signAccessToken(USER_A);
    tokenB = await signAccessToken(USER_B);
    listChanges.mockResolvedValue({ changes: [changeResult()], nextCursor: 'opaque-cursor-2' });
    listStatus.mockResolvedValue([statusResult()]);
    getProjectStatus.mockResolvedValue(statusResult());
  });

  describe('GET /api/v1/sync/changes', () => {
    it('lists changed resources with the next cursor', async () => {
      const response = await request(app)
        .get('/api/v1/sync/changes')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const body = SyncChangesResponseSchema.parse(response.body as unknown);

      expect(body.changes).toHaveLength(1);
      expect(body.nextCursor).toBe('opaque-cursor-2');
      expect(listChanges).toHaveBeenCalledWith(USER_A, { limit: 20 });
    });

    it('forwards since, cursor, and limit to the service', async () => {
      const since = encodeURIComponent('2026-07-29T09:00:00.000Z');
      await request(app)
        .get(`/api/v1/sync/changes?since=${since}&limit=5`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      expect(listChanges).toHaveBeenCalledWith(USER_A, {
        since: new Date('2026-07-29T09:00:00.000Z'),
        limit: 5,
      });

      await request(app)
        .get('/api/v1/sync/changes?cursor=opaque-cursor-2&limit=10')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      expect(listChanges).toHaveBeenLastCalledWith(USER_A, {
        cursor: 'opaque-cursor-2',
        limit: 10,
      });
    });

    it('rejects invalid since and limit values with 400', async () => {
      await request(app)
        .get('/api/v1/sync/changes?since=not-a-date')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(400);
      await request(app)
        .get('/api/v1/sync/changes?limit=0')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(400);
      await request(app)
        .get('/api/v1/sync/changes?limit=101')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(400);
      await request(app)
        .get('/api/v1/sync/changes?since=2026-07-29T09:00:00.000Z&cursor=opaque')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(400);
    });

    it('returns 400 INVALID_CURSOR for a malformed cursor', async () => {
      listChanges.mockRejectedValue(new InvalidCursorError());

      const response = await request(app)
        .get('/api/v1/sync/changes?cursor=bad')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(400);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe('INVALID_CURSOR');
    });

    it('requires authentication', async () => {
      await request(app).get('/api/v1/sync/changes').expect(401);
    });
  });

  describe('GET /api/v1/sync/status', () => {
    it('lists project statuses for the current user', async () => {
      const response = await request(app)
        .get('/api/v1/sync/status')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const body = SyncStatusListResponseSchema.parse(response.body as unknown);

      expect(body.items).toHaveLength(1);
      expect(listStatus).toHaveBeenCalledWith(USER_A);
    });

    it('returns a single project status when projectId is supplied', async () => {
      const response = await request(app)
        .get(`/api/v1/sync/status?projectId=${PROJECT_ID}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);
      const body = SyncProjectStatusSchema.parse(response.body as unknown);

      expect(body.projectId).toBe(PROJECT_ID);
      expect(getProjectStatus).toHaveBeenCalledWith(USER_B, PROJECT_ID);
    });

    it('returns 404 when the user has no access to the project', async () => {
      getProjectStatus.mockRejectedValue(new SyncProjectNotFoundError());

      const response = await request(app)
        .get(`/api/v1/sync/status?projectId=${PROJECT_ID}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe(
        'PROJECT_NOT_FOUND',
      );
    });

    it('rejects an invalid projectId with 400', async () => {
      await request(app)
        .get('/api/v1/sync/status?projectId=not-a-uuid')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(400);
    });

    it('requires authentication', async () => {
      await request(app).get('/api/v1/sync/status').expect(401);
    });
  });

  it('documents the sync endpoints in OpenAPI', async () => {
    const response = await request(app).get('/api-doc.json').expect(200);
    const body = response.body as { paths: Record<string, unknown> };

    expect(body.paths).toHaveProperty('/api/v1/sync/changes');
    expect(body.paths).toHaveProperty('/api/v1/sync/status');
  });
});
