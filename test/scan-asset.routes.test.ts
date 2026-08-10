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
import type { ProjectService } from '../src/modules/project/project.service.js';
import type { ScanService } from '../src/modules/scan/scan.service.js';
import type { NoteService } from '../src/modules/note/note.service.js';
import type { ShareService } from '../src/modules/share/share.service.js';
import {
  AssetMetadataResponseSchema,
  CreateUploadSessionResponseSchema,
  DownloadUrlResponseSchema,
  ListAssetsResponseSchema,
} from '../src/modules/scan-asset/scan-asset.schemas.js';
import {
  AssetNotReadyError,
  ScanAssetNotFoundError,
  StorageUnavailableError,
  UploadSessionExpiredError,
} from '../src/modules/scan-asset/scan-asset.errors.js';
import type { ScanAssetService } from '../src/modules/scan-asset/scan-asset.service.js';
import type {
  CreateUploadSessionResult,
  ScanAssetMetadata,
} from '../src/modules/scan-asset/scan-asset.types.js';
import { ScanNotFoundError } from '../src/modules/scan/scan.errors.js';

const ACCESS_SECRET = 'access-secret-that-is-at-least-32-characters';
const USER_A = 'eb5d278f-c857-45c7-887d-7be65288cb75';
const USER_B = 'f1a2b3c4-d5e6-7890-abcd-ef1234567890';
const SCAN_ID = 'f1e2d3c4-a5b6-7890-abcd-ef1234567890';
const UPLOAD_SESSION_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
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
  invitationBaseUrl: 'http://localhost:3000',
};

function assetMetadata(overrides: Partial<ScanAssetMetadata> = {}): ScanAssetMetadata {
  return {
    assetId: UPLOAD_SESSION_ID,
    scanId: SCAN_ID,
    assetType: 'MODEL',
    status: 'UPLOADED',
    contentType: 'model/gltf-binary',
    sizeBytes: 1024,
    checksum: 'abc-checksum',
    modelVersion: '1',
    uploadedAt: NOW.toISOString(),
    uploadSessionId: UPLOAD_SESSION_ID,
    uploadUrlExpiresAt: null,
    downloadUrlExpiresAt: null,
    ...overrides,
  };
}

function createSessionResult(created = true): CreateUploadSessionResult {
  return {
    uploadSessionId: UPLOAD_SESSION_ID,
    assetId: UPLOAD_SESSION_ID,
    assetType: 'MODEL',
    status: 'PENDING',
    uploadUrl: 'http://storage/upload',
    uploadUrlExpiresAt: NOW.toISOString(),
    created,
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

describe('Scan asset HTTP endpoints', () => {
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
      email: userId === USER_A ? 'owner@example.com' : 'viewer@example.com',
    }),
  );
  const currentUserRepository: CurrentUserRepository = {
    findById: findCurrentUser,
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
  const createUploadSession = vi.fn<ScanAssetService['createUploadSession']>();
  const completeUpload = vi.fn<ScanAssetService['completeUpload']>();
  const listAssets = vi.fn<ScanAssetService['listAssets']>();
  const getDownloadUrl = vi.fn<ScanAssetService['getDownloadUrl']>();
  const failUpload = vi.fn<ScanAssetService['failUpload']>();
  const scanAssetService = {
    createUploadSession,
    completeUpload,
    listAssets,
    getDownloadUrl,
    failUpload,
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
    createUploadSession.mockResolvedValue(createSessionResult(true));
    completeUpload.mockResolvedValue(assetMetadata());
    listAssets.mockResolvedValue({ items: [assetMetadata()] });
    getDownloadUrl.mockResolvedValue({
      downloadUrl: 'http://storage/download',
      downloadUrlExpiresAt: NOW.toISOString(),
      asset: assetMetadata(),
    });
    failUpload.mockResolvedValue(assetMetadata());
  });

  describe('POST /api/v1/scans/:scanId/assets/upload-sessions', () => {
    it('creates an upload session as the Owner', async () => {
      const response = await request(app)
        .post(`/api/v1/scans/${SCAN_ID}/assets/upload-sessions`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          assetType: 'MODEL',
          contentType: 'model/gltf-binary',
          sizeBytes: 1024,
          checksum: 'abc',
          modelVersion: '1',
        })
        .expect(201);
      const body = CreateUploadSessionResponseSchema.parse(response.body as unknown);

      expect(body.uploadSessionId).toBe(UPLOAD_SESSION_ID);
      expect(createUploadSession).toHaveBeenCalledWith(USER_A, SCAN_ID, {
        assetType: 'MODEL',
        contentType: 'model/gltf-binary',
        sizeBytes: 1024,
        checksum: 'abc',
        modelVersion: '1',
      });
    });

    it('returns 200 for an existing active session', async () => {
      createUploadSession.mockResolvedValue(createSessionResult(false));

      const response = await request(app)
        .post(`/api/v1/scans/${SCAN_ID}/assets/upload-sessions`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          assetType: 'MODEL',
          contentType: 'model/gltf-binary',
          sizeBytes: 1024,
          checksum: 'abc',
          modelVersion: '1',
          idempotencyKey: 'mutation-1',
        })
        .expect(200);
      const body = CreateUploadSessionResponseSchema.parse(response.body as unknown);

      expect(body.uploadSessionId).toBe(UPLOAD_SESSION_ID);
    });

    it('rejects a model without checksum and modelVersion', async () => {
      await request(app)
        .post(`/api/v1/scans/${SCAN_ID}/assets/upload-sessions`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ assetType: 'MODEL', contentType: 'model/gltf-binary', sizeBytes: 1024 })
        .expect(400);
    });

    it('rejects an unknown asset type', async () => {
      await request(app)
        .post(`/api/v1/scans/${SCAN_ID}/assets/upload-sessions`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          assetType: 'VIDEO',
          contentType: 'video/mp4',
          sizeBytes: 1024,
          checksum: 'abc',
          modelVersion: '1',
        })
        .expect(400);
    });

    it('rejects a non-positive size', async () => {
      await request(app)
        .post(`/api/v1/scans/${SCAN_ID}/assets/upload-sessions`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          assetType: 'THUMBNAIL',
          contentType: 'image/png',
          sizeBytes: 0,
        })
        .expect(400);
    });

    it('rejects a disallowed content type for the asset type', async () => {
      const response = await request(app)
        .post(`/api/v1/scans/${SCAN_ID}/assets/upload-sessions`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ assetType: 'THUMBNAIL', contentType: 'application/octet-stream', sizeBytes: 10 })
        .expect(400);
      const body = ErrorResponseSchema.parse(response.body as unknown);

      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('hides create from a Viewer', async () => {
      createUploadSession.mockRejectedValueOnce(new ScanNotFoundError());

      const response = await request(app)
        .post(`/api/v1/scans/${SCAN_ID}/assets/upload-sessions`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          assetType: 'MODEL',
          contentType: 'model/gltf-binary',
          sizeBytes: 1024,
          checksum: 'abc',
          modelVersion: '1',
        })
        .expect(404);
      const body = ErrorResponseSchema.parse(response.body as unknown);

      expect(body.error.code).toBe('SCAN_NOT_FOUND');
    });

    it('returns a safe 500 for unexpected errors', async () => {
      createUploadSession.mockRejectedValueOnce(new Error('secret=do-not-expose'));

      const response = await request(app)
        .post(`/api/v1/scans/${SCAN_ID}/assets/upload-sessions`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          assetType: 'MODEL',
          contentType: 'model/gltf-binary',
          sizeBytes: 1024,
          checksum: 'abc',
          modelVersion: '1',
        })
        .expect(500);
      const body = ErrorResponseSchema.parse(response.body as unknown);

      expect(body.error.code).toBe('INTERNAL_SERVER_ERROR');
      expect(JSON.stringify(body)).not.toContain('do-not-expose');
    });
  });

  describe('POST /api/v1/upload-sessions/:uploadSessionId/complete', () => {
    it('completes an upload for the Owner', async () => {
      const response = await request(app)
        .post(`/api/v1/upload-sessions/${UPLOAD_SESSION_ID}/complete`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({})
        .expect(200);
      const body = AssetMetadataResponseSchema.parse(response.body as unknown);

      expect(body.assetId).toBe(UPLOAD_SESSION_ID);
      expect(completeUpload).toHaveBeenCalledWith(USER_A, UPLOAD_SESSION_ID, {});
    });

    it('returns not-found for a missing session', async () => {
      completeUpload.mockRejectedValueOnce(new ScanAssetNotFoundError());

      const response = await request(app)
        .post(`/api/v1/upload-sessions/${UPLOAD_SESSION_ID}/complete`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({})
        .expect(404);
      const body = ErrorResponseSchema.parse(response.body as unknown);

      expect(body.error.code).toBe('ASSET_NOT_FOUND');
    });

    it('returns conflict for an expired session', async () => {
      completeUpload.mockRejectedValueOnce(new UploadSessionExpiredError());

      const response = await request(app)
        .post(`/api/v1/upload-sessions/${UPLOAD_SESSION_ID}/complete`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({})
        .expect(409);
      const body = ErrorResponseSchema.parse(response.body as unknown);

      expect(body.error.code).toBe('UPLOAD_SESSION_EXPIRED');
    });

    it('returns service unavailable when storage is down', async () => {
      completeUpload.mockRejectedValueOnce(new StorageUnavailableError());

      const response = await request(app)
        .post(`/api/v1/upload-sessions/${UPLOAD_SESSION_ID}/complete`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({})
        .expect(503);
      const body = ErrorResponseSchema.parse(response.body as unknown);

      expect(body.error.code).toBe('STORAGE_UNAVAILABLE');
    });
  });

  describe('GET /api/v1/scans/:scanId/assets', () => {
    it('lists assets for the Owner', async () => {
      const response = await request(app)
        .get(`/api/v1/scans/${SCAN_ID}/assets`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const body = ListAssetsResponseSchema.parse(response.body as unknown);

      expect(body.items).toHaveLength(1);
      expect(listAssets).toHaveBeenCalledWith(USER_A, SCAN_ID);
    });

    it('hides the list from a Viewer with no access', async () => {
      listAssets.mockRejectedValueOnce(new ScanNotFoundError());

      const response = await request(app)
        .get(`/api/v1/scans/${SCAN_ID}/assets`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);
      const body = ErrorResponseSchema.parse(response.body as unknown);

      expect(body.error.code).toBe('SCAN_NOT_FOUND');
    });
  });

  describe('GET /api/v1/scans/:scanId/assets/:assetType/download-url', () => {
    it('returns a download URL for an active Viewer', async () => {
      const response = await request(app)
        .get(`/api/v1/scans/${SCAN_ID}/assets/MODEL/download-url`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);
      const body = DownloadUrlResponseSchema.parse(response.body as unknown);

      expect(body.downloadUrl).toBe('http://storage/download');
      expect(getDownloadUrl).toHaveBeenCalledWith(USER_B, SCAN_ID, 'MODEL');
    });

    it('returns asset-not-ready when the asset is not uploaded', async () => {
      getDownloadUrl.mockRejectedValueOnce(new AssetNotReadyError());

      const response = await request(app)
        .get(`/api/v1/scans/${SCAN_ID}/assets/MODEL/download-url`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(409);
      const body = ErrorResponseSchema.parse(response.body as unknown);

      expect(body.error.code).toBe('ASSET_NOT_READY');
    });

    it('returns not-found when the asset record is missing', async () => {
      getDownloadUrl.mockRejectedValueOnce(new ScanAssetNotFoundError());

      const response = await request(app)
        .get(`/api/v1/scans/${SCAN_ID}/assets/MODEL/download-url`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(404);
      const body = ErrorResponseSchema.parse(response.body as unknown);

      expect(body.error.code).toBe('ASSET_NOT_FOUND');
    });

    it('rejects an invalid asset type', async () => {
      await request(app)
        .get(`/api/v1/scans/${SCAN_ID}/assets/VIDEO/download-url`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(400);
    });

    it('hides the download URL from a revoked Viewer', async () => {
      getDownloadUrl.mockRejectedValueOnce(new ScanNotFoundError());

      const response = await request(app)
        .get(`/api/v1/scans/${SCAN_ID}/assets/MODEL/download-url`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);
      const body = ErrorResponseSchema.parse(response.body as unknown);

      expect(body.error.code).toBe('SCAN_NOT_FOUND');
    });
  });

  describe('POST /api/v1/upload-sessions/:uploadSessionId/fail', () => {
    it('marks an upload failed for the Owner', async () => {
      await request(app)
        .post(`/api/v1/upload-sessions/${UPLOAD_SESSION_ID}/fail`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ reason: 'timeout' })
        .expect(200);

      expect(failUpload).toHaveBeenCalledWith(USER_A, UPLOAD_SESSION_ID, {
        reason: 'timeout',
      });
    });

    it('returns not-found for a missing session', async () => {
      failUpload.mockRejectedValueOnce(new ScanAssetNotFoundError());

      const response = await request(app)
        .post(`/api/v1/upload-sessions/${UPLOAD_SESSION_ID}/fail`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({})
        .expect(404);
      const body = ErrorResponseSchema.parse(response.body as unknown);

      expect(body.error.code).toBe('ASSET_NOT_FOUND');
    });
  });

  describe('OpenAPI document', () => {
    it('documents all asset operations', async () => {
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

      expect(body.paths).toHaveProperty('/api/v1/scans/{scanId}/assets/upload-sessions');
      expect(body.paths).toHaveProperty('/api/v1/scans/{scanId}/assets/{assetType}/download-url');
      expect(body.paths).toHaveProperty('/api/v1/upload-sessions/{uploadSessionId}/complete');
      expect(body.components.securitySchemes).toHaveProperty('BearerAuth');
      expect(JSON.stringify(body.components.schemas.CreateUploadSessionResponse)).toContain(
        '"uploadUrl"',
      );
    });
  });

  it('requires a valid token to create an upload session', async () => {
    await request(app)
      .post(`/api/v1/scans/${SCAN_ID}/assets/upload-sessions`)
      .send({ assetType: 'MODEL', contentType: 'model/gltf-binary', sizeBytes: 1 })
      .expect(401);
  });
});
