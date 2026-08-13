import { SignJWT, jwtVerify } from 'jose';
import pino from 'pino';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import { IdempotencyKeyInProgressError } from '../src/common/idempotency/idempotency.errors.js';
import { idempotencyMiddleware } from '../src/common/idempotency/idempotency.middleware.js';
import type {
  IdempotencyRecord,
  IdempotencyRepository,
  IdempotencyReserveInput,
} from '../src/common/idempotency/idempotency.types.js';
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
import { ProjectResponseSchema } from '../src/modules/project/project.schemas.js';
import type { ProjectService } from '../src/modules/project/project.service.js';
import type { ScanService } from '../src/modules/scan/scan.service.js';
import type { ScanAssetService } from '../src/modules/scan-asset/scan-asset.service.js';
import type { NoteService } from '../src/modules/note/note.service.js';
import type { ShareService } from '../src/modules/share/share.service.js';
import type { SharedProjectsService } from '../src/modules/shared-projects/shared-projects.service.js';
import type { SyncService } from '../src/modules/sync/sync.service.js';
import type { ProjectResult } from '../src/modules/project/project.types.js';
import { RevisionConflictError } from '../src/common/errors/revision-conflict.js';

const ACCESS_SECRET = 'access-secret-that-is-at-least-32-characters';
const USER_A = 'eb5d278f-c857-45c7-887d-7be65288cb75';
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

class FakeIdempotencyRepository implements IdempotencyRepository {
  readonly store = new Map<string, IdempotencyRecord>();
  #sequence = 0;

  findByUserAndKey(userId: string, key: string): Promise<IdempotencyRecord | null> {
    return Promise.resolve(this.store.get(`${userId}:${key}`) ?? null);
  }

  reserve(input: IdempotencyReserveInput): Promise<void> {
    const id = `${input.userId}:${input.key}`;
    if (this.store.has(id)) {
      return Promise.reject(new IdempotencyKeyInProgressError());
    }
    this.store.set(id, {
      id: `idempotency-${++this.#sequence}`,
      userId: input.userId,
      key: input.key,
      requestHash: input.requestHash,
      statusCode: 0,
      responseBody: null,
      createdAt: NOW,
      expiresAt: input.expiresAt,
    });
    return Promise.resolve();
  }

  finalize(userId: string, key: string, statusCode: number, responseBody: unknown): Promise<void> {
    const id = `${userId}:${key}`;
    const existing = this.store.get(id);
    if (existing !== undefined) {
      this.store.set(id, { ...existing, statusCode, responseBody });
    }
    return Promise.resolve();
  }

  release(userId: string, key: string): Promise<void> {
    this.store.delete(`${userId}:${key}`);
    return Promise.resolve();
  }
}

function projectResult(): ProjectResult {
  return {
    id: PROJECT_ID,
    name: 'District 2 Apartment',
    description: null,
    owner: { id: USER_A, email: 'owner@example.com' },
    scanCount: 0,
    scans: [],
    sharedCount: 0,
    thumbnail: null,
    syncStatus: null,
    revision: 1,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    permissions: {
      role: 'OWNER',
      canView: true,
      canEdit: true,
      canDelete: true,
      canShare: true,
      canCreateScan: true,
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

describe('Idempotency and optimistic concurrency through the HTTP layer', () => {
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
    findById: vi.fn((userId: string) =>
      Promise.resolve({ id: userId, email: 'owner@example.com' }),
    ),
  };
  const createProject = vi.fn<ProjectService['create']>();
  const updateProject = vi.fn<ProjectService['update']>();
  const projectService = {
    create: createProject,
    list: vi.fn(),
    getById: vi.fn(),
    update: updateProject,
    delete: vi.fn(),
  } as unknown as ProjectService;
  const createNote = vi.fn<NoteService['create']>();
  const noteService = {
    create: createNote,
    list: vi.fn(),
    getById: vi.fn(),
    update: vi.fn(),
    move: vi.fn(),
    delete: vi.fn(),
  } as unknown as NoteService;
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
  const syncService = {
    listChanges: vi.fn(),
    listStatus: vi.fn(),
    getProjectStatus: vi.fn(),
  } as unknown as SyncService;
  const idempotencyRepository = new FakeIdempotencyRepository();
  const idempotencyMiddlewareInstance = idempotencyMiddleware({
    repository: idempotencyRepository,
    clock: () => NOW,
    ttlSeconds: config.idempotencyKeyTtlSeconds,
  });
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
    idempotencyMiddleware: idempotencyMiddlewareInstance,
    accessTokenVerifier,
    currentUserRepository,
    rateLimiters,
    clock: () => NOW,
  });

  let token: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    idempotencyRepository.store.clear();
    token = await signAccessToken(USER_A);
    createProject.mockResolvedValue(projectResult());
  });

  it('returns the original result for a retried create project with the same key and body', async () => {
    const body = { name: 'District 2 Apartment', description: null };

    const first = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'create-project-abc')
      .send(body)
      .expect(201);
    const retried = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'create-project-abc')
      .send(body)
      .expect(201);

    expect(retried.body).toEqual(first.body);
    expect(ProjectResponseSchema.parse(retried.body as unknown).id).toBe(PROJECT_ID);
    expect(createProject).toHaveBeenCalledTimes(1);
  });

  it('returns 409 when the same key is reused with a different body', async () => {
    await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'create-project-abc')
      .send({ name: 'District 2 Apartment' })
      .expect(201);

    const response = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'create-project-abc')
      .send({ name: 'A different project' })
      .expect(409);

    expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe(
      'IDEMPOTENCY_KEY_MISMATCH',
    );
    expect(createProject).toHaveBeenCalledTimes(1);
  });

  it('applies the idempotency key to retried note creates', async () => {
    createNote.mockResolvedValue({
      id: 'b1a2c3d4-e5f6-4890-abcd-ef1234567890',
      scanId: 'f1e2d3c4-a5b6-7890-abcd-ef1234567890',
      content: 'Hinge is loose',
      color: 'YELLOW',
      position: { x: 1, y: 2, z: 3 },
      orientation: null,
      modelVersion: '1',
      revision: 1,
      creator: { id: USER_A, email: 'owner@example.com' },
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      permissions: { role: 'OWNER', canView: true, canEdit: true, canDelete: true },
    });
    const body = {
      content: 'Hinge is loose',
      color: 'YELLOW',
      position: { x: 1, y: 2, z: 3 },
      modelVersion: '1',
    };

    await request(app)
      .post('/api/v1/scans/f1e2d3c4-a5b6-7890-abcd-ef1234567890/notes')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'create-note-xyz')
      .send(body)
      .expect(201);
    await request(app)
      .post('/api/v1/scans/f1e2d3c4-a5b6-7890-abcd-ef1234567890/notes')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'create-note-xyz')
      .send(body)
      .expect(201);

    expect(createNote).toHaveBeenCalledTimes(1);
  });

  it('rejects a stale PATCH project with 409 when If-Match is outdated', async () => {
    updateProject.mockRejectedValue(new RevisionConflictError());

    const response = await request(app)
      .patch(`/api/v1/projects/${PROJECT_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .set('If-Match', '1')
      .send({ name: 'Renamed' })
      .expect(409);

    expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe(
      'REVISION_CONFLICT',
    );
    expect(updateProject).toHaveBeenCalledWith(USER_A, PROJECT_ID, { name: 'Renamed' }, 1);
  });

  it('applies a matching If-Match revision to an owned update', async () => {
    updateProject.mockResolvedValue({ ...projectResult(), name: 'Renamed' });

    await request(app)
      .patch(`/api/v1/projects/${PROJECT_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .set('If-Match', '3')
      .send({ name: 'Renamed' })
      .expect(200);

    expect(updateProject).toHaveBeenCalledWith(USER_A, PROJECT_ID, { name: 'Renamed' }, 3);
  });

  it('rejects a malformed If-Match value with 400', async () => {
    const response = await request(app)
      .patch(`/api/v1/projects/${PROJECT_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .set('If-Match', 'not-a-number')
      .send({ name: 'Renamed' })
      .expect(400);

    expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe('VALIDATION_ERROR');
    expect(updateProject).not.toHaveBeenCalled();
  });

  it('lets a deleted project win over a stale update', async () => {
    updateProject.mockRejectedValue(new ProjectNotFoundError());

    const response = await request(app)
      .patch(`/api/v1/projects/${PROJECT_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .set('If-Match', '1')
      .send({ name: 'Renamed' })
      .expect(404);

    expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe(
      'PROJECT_NOT_FOUND',
    );
  });

  it('returns 400 for an over-length Idempotency-Key', async () => {
    await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'k'.repeat(129))
      .send({ name: 'Test' })
      .expect(400);
  });

  it('releases the key after a failed request so the retry can succeed', async () => {
    createProject.mockRejectedValueOnce(new Error('transient failure'));
    const body = { name: 'Retry Demo Project' };

    await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'flaky-create')
      .send(body)
      .expect(500);

    createProject.mockResolvedValue(projectResult());
    await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'flaky-create')
      .send(body)
      .expect(201);

    expect(createProject).toHaveBeenCalledTimes(2);
  });
});
