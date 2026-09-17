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
import { TOKEN_AUDIENCE, TOKEN_ISSUER } from '../src/config/constants.js';
import type { AppConfig } from '../src/config/env.js';
import type { DatabaseHealth } from '../src/infrastructure/database/database.js';
import type { AppleAuthService, TokenRefreshService } from '../src/modules/auth/auth.types.js';
import { ProjectNotFoundError } from '../src/modules/project/project.errors.js';
import {
  ProjectListResponseSchema,
  ProjectResponseSchema,
} from '../src/modules/project/project.schemas.js';
import type { ProjectService } from '../src/modules/project/project.service.js';
import type { ScanService } from '../src/modules/scan/scan.service.js';
import type { ScanAssetService } from '../src/modules/scan-asset/scan-asset.service.js';
import type { NoteService } from '../src/modules/note/note.service.js';
import type { ShareService } from '../src/modules/share/share.service.js';
import type { ShareLinkService } from '../src/modules/share/share-link.service.js';
import type { SharedProjectsService } from '../src/modules/shared-projects/shared-projects.service.js';
import type { SharedScansService } from '../src/modules/shared-scans/shared-scans.service.js';
import type { SyncService } from '../src/modules/sync/sync.service.js';
import type { UserProfileService } from '../src/modules/users/users.types.js';
import type { ProjectResult, ProjectRole } from '../src/modules/project/project.types.js';

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

function projectResult(role: ProjectRole = 'OWNER'): ProjectResult {
  const isOwner = role === 'OWNER';
  return {
    id: PROJECT_ID,
    name: 'Căn hộ Quận 2',
    description: 'Apartment survey',
    owner: {
      id: USER_A,
      email: 'owner@example.com',
      displayName: null,
    },
    scanCount: 0,
    scans: [],
    sharedCount: 1,
    thumbnail: null,
    syncStatus: null,
    revision: 1,
    lastSyncedAt: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    permissions: {
      role,
      canView: true,
      canEdit: isOwner,
      canDelete: isOwner,
      canShare: isOwner,
      canCreateScan: isOwner,
    },
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

describe('Project HTTP endpoints', () => {
  const database: DatabaseHealth = {
    checkConnection: vi.fn(() => Promise.resolve()),
    disconnect: vi.fn(() => Promise.resolve()),
  };
  const logger = pino({ enabled: false });
  const rateLimiters = createRateLimiters(config, logger);
  const authService: AppleAuthService = {
    signInWithApple: vi.fn(),
  };
  const refreshTokenService: TokenRefreshService = {
    refresh: vi.fn(),
  };
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
  const create = vi.fn<ProjectService['create']>();
  const list = vi.fn<ProjectService['list']>();
  const getById = vi.fn<ProjectService['getById']>();
  const update = vi.fn<ProjectService['update']>();
  const deleteProject = vi.fn<ProjectService['delete']>();
  const projectService = {
    create,
    list,
    getById,
    update,
    delete: deleteProject,
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
    create.mockResolvedValue(projectResult());
    list.mockResolvedValue({
      items: [],
      pagination: {
        page: 1,
        limit: 5,
        total: 0,
        totalPages: 0,
      },
    });
    getById.mockResolvedValue(projectResult());
    update.mockResolvedValue({
      ...projectResult(),
      name: 'Updated scan',
      description: 'Second floor',
    });
    deleteProject.mockResolvedValue(1);
  });

  describe('POST /api/v1/projects', () => {
    it('creates a Unicode-named project and returns the complete representation', async () => {
      const response = await request(app)
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('Idempotency-Key', 'project-create-1')
        .send({ name: '  Căn hộ Quận 2  ', description: 'Apartment survey' })
        .expect(201);
      const body = ProjectResponseSchema.parse(response.body as unknown);

      expect(body).toEqual(projectResult());
      expect(create).toHaveBeenCalledWith(USER_A, {
        name: 'Căn hộ Quận 2',
        description: 'Apartment survey',
      });
    });

    it('defaults description to null and accepts the 50/500 boundaries', async () => {
      await request(app)
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('Idempotency-Key', 'project-create-boundary')
        .send({ name: 'x'.repeat(50), description: 'y'.repeat(500) })
        .expect(201);
      await request(app)
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('Idempotency-Key', 'project-create-null-description')
        .send({ name: 'No description' })
        .expect(201);

      expect(create).toHaveBeenLastCalledWith(USER_A, {
        name: 'No description',
        description: null,
      });
    });

    it.each([
      [{}, 'missing name'],
      [{ name: '   ' }, 'blank name'],
      [{ name: 'x'.repeat(51) }, 'long name'],
      [{ name: 'Project', description: 'y'.repeat(501) }, 'long description'],
      [{ name: 'Project', ownerId: USER_A }, 'unknown field'],
    ])('rejects invalid input: %s (%s)', async (body, _label) => {
      const response = await request(app)
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${tokenA}`)
        .send(body)
        .expect(400);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe(
        'VALIDATION_ERROR',
      );
    });

    it('requires a valid token for an existing current user', async () => {
      await request(app).post('/api/v1/projects').send({ name: 'Test' }).expect(401);

      findCurrentUser.mockResolvedValueOnce(null);
      const response = await request(app)
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Test' })
        .expect(401);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe('UNAUTHORIZED');
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/projects', () => {
    it('uses the page-one, five-item, latest-activity defaults', async () => {
      list.mockResolvedValue({
        items: [projectResult()],
        pagination: {
          page: 1,
          limit: 5,
          total: 1,
          totalPages: 1,
        },
      });

      const response = await request(app)
        .get('/api/v1/projects')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const body = ProjectListResponseSchema.parse(response.body as unknown);

      expect(body.items).toHaveLength(1);
      expect(body.pagination).toEqual({
        page: 1,
        limit: 5,
        total: 1,
        totalPages: 1,
      });
      expect(list).toHaveBeenCalledWith(USER_A, {
        page: 1,
        limit: 5,
        sort: 'updatedAt:desc',
      });
    });

    it('includes each project’s scans in the list response', async () => {
      list.mockResolvedValue({
        items: [
          {
            ...projectResult(),
            scanCount: 1,
            scans: [
              {
                id: 'f1e2d3c4-a5b6-7890-abcd-ef1234567890',
                name: 'Living Room',
                description: null,
                thumbnail: 'http://storage.local/download/scans/scan/thumbnail',
                noteCount: 3,
                assetStatus: 'UPLOADED',
                syncStatus: 'SYNCED',
                createdAt: NOW.toISOString(),
              },
            ],
          },
        ],
        pagination: {
          page: 1,
          limit: 5,
          total: 1,
          totalPages: 1,
        },
      });

      const response = await request(app)
        .get('/api/v1/projects')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const body = ProjectListResponseSchema.parse(response.body as unknown);

      expect(body.items[0]?.scans).toEqual([
        {
          id: 'f1e2d3c4-a5b6-7890-abcd-ef1234567890',
          name: 'Living Room',
          description: null,
          thumbnail: 'http://storage.local/download/scans/scan/thumbnail',
          noteCount: 3,
          assetStatus: 'UPLOADED',
          syncStatus: 'SYNCED',
          createdAt: NOW.toISOString(),
        },
      ]);
    });

    it('passes trimmed search, page, limit, and supported sort to the service', async () => {
      await request(app)
        .get('/api/v1/projects?search=%20C%C4%83n%20h%E1%BB%99%20&page=2&limit=10&sort=name%3Aasc')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      expect(list).toHaveBeenCalledWith(USER_A, {
        search: 'Căn hộ',
        page: 2,
        limit: 10,
        sort: 'name:asc',
      });
    });

    it('treats blank search as absent', async () => {
      await request(app)
        .get('/api/v1/projects?search=%20%20')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      expect(list).toHaveBeenCalledWith(USER_A, {
        page: 1,
        limit: 5,
        sort: 'updatedAt:desc',
      });
    });

    it.each([
      'page=0',
      'page=1.5',
      'limit=0',
      'limit=101',
      'sort=updatedAt',
      'sort=id%3Aasc',
      'cursor=legacy',
    ])('rejects invalid list query %s', async (query) => {
      const response = await request(app)
        .get(`/api/v1/projects?${query}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(400);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe(
        'VALIDATION_ERROR',
      );
    });
  });

  describe('GET /api/v1/projects/:projectId', () => {
    it('returns Owner project detail', async () => {
      const response = await request(app)
        .get(`/api/v1/projects/${PROJECT_ID}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const body = ProjectResponseSchema.parse(response.body as unknown);

      expect(body.permissions.role).toBe('OWNER');
      expect(getById).toHaveBeenCalledWith(USER_A, PROJECT_ID);
    });

    it('returns read-only detail to an active Viewer', async () => {
      getById.mockResolvedValueOnce(projectResult('VIEWER'));

      const response = await request(app)
        .get(`/api/v1/projects/${PROJECT_ID}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);
      const body = ProjectResponseSchema.parse(response.body as unknown);

      expect(body.permissions).toMatchObject({
        role: 'VIEWER',
        canView: true,
        canEdit: false,
        canDelete: false,
      });
      expect(getById).toHaveBeenCalledWith(USER_B, PROJECT_ID);
    });

    it('returns the same hidden 404 for missing, deleted, revoked, or inaccessible projects', async () => {
      getById.mockRejectedValueOnce(new ProjectNotFoundError());

      const response = await request(app)
        .get(`/api/v1/projects/${PROJECT_ID}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe(
        'PROJECT_NOT_FOUND',
      );
    });

    it('rejects an invalid project UUID', async () => {
      await request(app)
        .get('/api/v1/projects/not-a-uuid')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(400);
    });
  });

  describe('PATCH /api/v1/projects/:projectId', () => {
    it('updates an owned project and can clear its description', async () => {
      const response = await request(app)
        .patch(`/api/v1/projects/${PROJECT_ID}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('If-Match', '"1"')
        .send({ name: '  Updated scan  ', description: null })
        .expect(200);
      const body = ProjectResponseSchema.parse(response.body as unknown);

      expect(body.name).toBe('Updated scan');
      expect(update).toHaveBeenCalledWith(USER_A, PROJECT_ID, 1, {
        name: 'Updated scan',
        description: null,
      });
    });

    it.each([
      {},
      { name: '   ' },
      { name: 'x'.repeat(51) },
      { description: 'y'.repeat(501) },
      { ownerId: USER_A },
    ])('rejects invalid partial updates: %s', async (body) => {
      await request(app)
        .patch(`/api/v1/projects/${PROJECT_ID}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send(body)
        .expect(400);
    });

    it('hides update from a Viewer or unrelated user', async () => {
      update.mockRejectedValueOnce(new ProjectNotFoundError());

      const response = await request(app)
        .patch(`/api/v1/projects/${PROJECT_ID}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .set('If-Match', '"1"')
        .send({ name: 'Forbidden' })
        .expect(404);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe(
        'PROJECT_NOT_FOUND',
      );
    });
  });

  describe('DELETE /api/v1/projects/:projectId', () => {
    it('returns 204 for the initial and repeated Owner deletion', async () => {
      await request(app)
        .delete(`/api/v1/projects/${PROJECT_ID}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('If-Match', '"1"')
        .expect(204);
      await request(app)
        .delete(`/api/v1/projects/${PROJECT_ID}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('If-Match', '"1"')
        .expect(204);

      expect(deleteProject).toHaveBeenCalledTimes(2);
      expect(deleteProject).toHaveBeenLastCalledWith(USER_A, PROJECT_ID, 1);
    });

    it('hides deletion from a Viewer or unrelated user', async () => {
      deleteProject.mockRejectedValueOnce(new ProjectNotFoundError());

      const response = await request(app)
        .delete(`/api/v1/projects/${PROJECT_ID}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .set('If-Match', '"1"')
        .expect(404);

      expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe(
        'PROJECT_NOT_FOUND',
      );
    });
  });

  describe('OpenAPI document', () => {
    it('documents all five operations, Bearer auth, page query, and response permissions', async () => {
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

      expect(body.paths).toHaveProperty('/api/v1/projects');
      expect(body.paths).toHaveProperty('/api/v1/projects/{projectId}');
      expect(body.components.securitySchemes).toHaveProperty('BearerAuth');
      expect(JSON.stringify(body.paths['/api/v1/projects'])).toContain('"page"');
      expect(JSON.stringify(body.components.schemas.ProjectResponse)).toContain('"permissions"');
    });
  });

  it('returns a safe 500 response for unexpected service errors', async () => {
    create.mockRejectedValueOnce(new Error('secret=do-not-expose'));

    const response = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${tokenA}`)
      .set('Idempotency-Key', 'project-create-error')
      .send({ name: 'Test' })
      .expect(500);
    const body = ErrorResponseSchema.parse(response.body as unknown);

    expect(body.error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(JSON.stringify(body)).not.toContain('do-not-expose');
  });
});
