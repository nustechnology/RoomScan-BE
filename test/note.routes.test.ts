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
import { ModelVersionMismatchError, NoteNotFoundError } from '../src/modules/note/note.errors.js';
import { NoteListResponseSchema, NoteResponseSchema } from '../src/modules/note/note.schemas.js';
import type { NoteService } from '../src/modules/note/note.service.js';
import type { ShareService } from '../src/modules/share/share.service.js';
import type { ShareLinkService } from '../src/modules/share/share-link.service.js';
import type { SharedProjectsService } from '../src/modules/shared-projects/shared-projects.service.js';
import type { SharedScansService } from '../src/modules/shared-scans/shared-scans.service.js';
import type { NoteResult } from '../src/modules/note/note.types.js';
import type { ProjectService } from '../src/modules/project/project.service.js';
import type { ScanService } from '../src/modules/scan/scan.service.js';
import type { ScanAssetService } from '../src/modules/scan-asset/scan-asset.service.js';
import { ScanNotFoundError } from '../src/modules/scan/scan.errors.js';

const ACCESS_SECRET = 'access-secret-that-is-at-least-32-characters';
const USER_A = 'eb5d278f-c857-45c7-887d-7be65288cb75';
const USER_B = 'f1a2b3c4-d5e6-7890-abcd-ef1234567890';
const SCAN_ID = 'f1e2d3c4-a5b6-7890-abcd-ef1234567890';
const NOTE_ID = 'b1a2c3d4-e5f6-4890-abcd-ef1234567890';
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
  storageUploadUrlTtlSeconds: 900,
  storageDownloadUrlTtlSeconds: 60,
  assetMinModelSizeBytes: 10_000_000,
  assetMaxModelSizeBytes: 500_000_000,
  assetMaxThumbnailSizeBytes: 10_000_000,
  invitationTtlSeconds: 604_800,
  invitationBaseUrl: 'http://localhost:3000',
  mailProvider: 'log',
  smtpHost: '',
  smtpPort: 2525,
  smtpUser: '',
  smtpPass: '',
  smtpSecure: false,
  mailFrom: 'RoomScan App <notifications@roomscan.app>',
};

function noteResult(overrides: Partial<NoteResult> = {}): NoteResult {
  return {
    id: NOTE_ID,
    scanId: SCAN_ID,
    title: 'Cabinet hinge',
    content: 'Cabinet hinge is loose',
    color: 'YELLOW',
    position: { x: 1.5, y: -2, z: 3.25 },
    orientation: { x: 0, y: 0, z: 1 },
    modelVersion: '1',
    revision: 1,
    creator: {
      id: USER_A,
      email: 'owner@example.com',
    },
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

describe('Note HTTP endpoints', () => {
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
        email: userId === USER_A ? 'owner@example.com' : 'viewer@example.com',
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
  const create = vi.fn<NoteService['create']>();
  const list = vi.fn<NoteService['list']>();
  const getById = vi.fn<NoteService['getById']>();
  const update = vi.fn<NoteService['update']>();
  const move = vi.fn<NoteService['move']>();
  const remove = vi.fn<NoteService['delete']>();
  const noteService = {
    create,
    list,
    getById,
    update,
    move,
    delete: remove,
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

  let tokenA: string;
  let tokenB: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tokenA = await signAccessToken(USER_A);
    tokenB = await signAccessToken(USER_B);
    create.mockResolvedValue(noteResult());
    list.mockResolvedValue({
      items: [noteResult()],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    getById.mockResolvedValue(noteResult());
    update.mockResolvedValue(noteResult({ title: 'Updated title', content: 'Updated content' }));
    move.mockResolvedValue(noteResult({ position: { x: 9, y: 8, z: 7 } }));
    remove.mockResolvedValue(1);
  });

  describe('POST /api/v1/scans/:scanId/notes', () => {
    it('creates a note and returns 201', async () => {
      const response = await request(app)
        .post(`/api/v1/scans/${SCAN_ID}/notes`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('Idempotency-Key', 'note-create-1')
        .send({
          title: 'Cabinet hinge',
          content: 'Cabinet hinge is loose',
          color: 'YELLOW',
          position: { x: 1.5, y: -2, z: 3.25 },
          orientation: { x: 0, y: 0, z: 1 },
          modelVersion: '1',
        })
        .expect(201);
      const body = NoteResponseSchema.parse(response.body as unknown);

      expect(body).toMatchObject(noteResult());
      expect(create).toHaveBeenCalledWith(USER_A, SCAN_ID, {
        title: 'Cabinet hinge',
        content: 'Cabinet hinge is loose',
        color: 'YELLOW',
        position: { x: 1.5, y: -2, z: 3.25 },
        orientation: { x: 0, y: 0, z: 1 },
        modelVersion: '1',
      });
    });

    it('accepts the new CYAN and GRAY colors', async () => {
      await request(app)
        .post(`/api/v1/scans/${SCAN_ID}/notes`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('Idempotency-Key', 'note-create-cyan')
        .send({
          title: 'Cyan note',
          content: 'Cyan content',
          color: 'CYAN',
          position: { x: 1, y: 2, z: 3 },
          modelVersion: '1',
        })
        .expect(201);
      await request(app)
        .post(`/api/v1/scans/${SCAN_ID}/notes`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('Idempotency-Key', 'note-create-gray')
        .send({
          title: 'Gray note',
          content: 'Gray content',
          color: 'GRAY',
          position: { x: 1, y: 2, z: 3 },
          modelVersion: '1',
        })
        .expect(201);
    });

    it('rejects missing title', async () => {
      await request(app)
        .post(`/api/v1/scans/${SCAN_ID}/notes`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          content: 'Note',
          color: 'YELLOW',
          position: { x: 1, y: 2, z: 3 },
          modelVersion: '1',
        })
        .expect(400);
    });

    it('rejects blank title', async () => {
      await request(app)
        .post(`/api/v1/scans/${SCAN_ID}/notes`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          title: '   ',
          content: 'Note',
          color: 'YELLOW',
          position: { x: 1, y: 2, z: 3 },
          modelVersion: '1',
        })
        .expect(400);
    });

    it('rejects title longer than 50 characters', async () => {
      await request(app)
        .post(`/api/v1/scans/${SCAN_ID}/notes`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          title: 'y'.repeat(51),
          content: 'Note',
          color: 'YELLOW',
          position: { x: 1, y: 2, z: 3 },
          modelVersion: '1',
        })
        .expect(400);
    });

    it('accepts a note without orientation', async () => {
      await request(app)
        .post(`/api/v1/scans/${SCAN_ID}/notes`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('Idempotency-Key', 'note-create-no-orientation')
        .send({
          title: 'Plain note',
          content: 'Plain note',
          color: 'BLUE',
          position: { x: 0, y: 1, z: 2 },
          modelVersion: '1',
        })
        .expect(201);

      expect(create).toHaveBeenCalledWith(
        USER_A,
        SCAN_ID,
        expect.objectContaining({ orientation: null }),
      );
    });

    it('rejects empty content', async () => {
      await request(app)
        .post(`/api/v1/scans/${SCAN_ID}/notes`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          title: 'Title',
          content: '   ',
          color: 'YELLOW',
          position: { x: 1, y: 2, z: 3 },
          modelVersion: '1',
        })
        .expect(400);
    });

    it('rejects missing content', async () => {
      await request(app)
        .post(`/api/v1/scans/${SCAN_ID}/notes`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          title: 'Title',
          color: 'YELLOW',
          position: { x: 1, y: 2, z: 3 },
          modelVersion: '1',
        })
        .expect(400);
    });

    it('rejects content longer than 2000 characters', async () => {
      await request(app)
        .post(`/api/v1/scans/${SCAN_ID}/notes`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          title: 'Title',
          content: 'y'.repeat(2001),
          color: 'YELLOW',
          position: { x: 1, y: 2, z: 3 },
          modelVersion: '1',
        })
        .expect(400);
    });

    it('rejects an invalid color', async () => {
      await request(app)
        .post(`/api/v1/scans/${SCAN_ID}/notes`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          title: 'Note',
          content: 'Note',
          color: 'PINK',
          position: { x: 1, y: 2, z: 3 },
          modelVersion: '1',
        })
        .expect(400);
    });

    it('rejects a non-numeric position', async () => {
      await request(app)
        .post(`/api/v1/scans/${SCAN_ID}/notes`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          title: 'Note',
          content: 'Note',
          color: 'YELLOW',
          position: { x: 'left', y: 2, z: 3 },
          modelVersion: '1',
        })
        .expect(400);
    });

    it('rejects a missing modelVersion', async () => {
      await request(app)
        .post(`/api/v1/scans/${SCAN_ID}/notes`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          title: 'Note',
          content: 'Note',
          color: 'YELLOW',
          position: { x: 1, y: 2, z: 3 },
        })
        .expect(400);
    });

    it('rejects unknown fields', async () => {
      await request(app)
        .post(`/api/v1/scans/${SCAN_ID}/notes`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          title: 'Note',
          content: 'Note',
          color: 'YELLOW',
          position: { x: 1, y: 2, z: 3 },
          modelVersion: '1',
          ownerId: USER_A,
        })
        .expect(400);
    });

    it('requires a valid token for an existing current user', async () => {
      await request(app)
        .post(`/api/v1/scans/${SCAN_ID}/notes`)
        .send({
          title: 'Title',
          content: 'Note',
          color: 'YELLOW',
          position: { x: 1, y: 2, z: 3 },
          modelVersion: '1',
        })
        .expect(401);
    });

    it('hides create from a Viewer', async () => {
      create.mockRejectedValueOnce(new ScanNotFoundError());

      const response = await request(app)
        .post(`/api/v1/scans/${SCAN_ID}/notes`)
        .set('Authorization', `Bearer ${tokenB}`)
        .set('Idempotency-Key', 'note-create-viewer')
        .send({
          title: 'Title',
          content: 'Note',
          color: 'YELLOW',
          position: { x: 1, y: 2, z: 3 },
          modelVersion: '1',
        })
        .expect(404);
      const body = ErrorResponseSchema.parse(response.body as unknown);

      expect(body.error.code).toBe('SCAN_NOT_FOUND');
    });

    it('returns 409 for a model version mismatch', async () => {
      create.mockRejectedValueOnce(new ModelVersionMismatchError());

      const response = await request(app)
        .post(`/api/v1/scans/${SCAN_ID}/notes`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('Idempotency-Key', 'note-create-stale-model')
        .send({
          title: 'Title',
          content: 'Stale note',
          color: 'YELLOW',
          position: { x: 1, y: 2, z: 3 },
          modelVersion: '2',
        })
        .expect(409);
      const body = ErrorResponseSchema.parse(response.body as unknown);

      expect(body.error.code).toBe('MODEL_VERSION_MISMATCH');
    });

    it('returns a safe 500 for unexpected errors', async () => {
      create.mockRejectedValueOnce(new Error('secret=do-not-expose'));

      const response = await request(app)
        .post(`/api/v1/scans/${SCAN_ID}/notes`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('Idempotency-Key', 'note-create-error')
        .send({
          title: 'Title',
          content: 'Note',
          color: 'YELLOW',
          position: { x: 1, y: 2, z: 3 },
          modelVersion: '1',
        })
        .expect(500);
      const body = ErrorResponseSchema.parse(response.body as unknown);

      expect(body.error.code).toBe('INTERNAL_SERVER_ERROR');
      expect(JSON.stringify(body)).not.toContain('do-not-expose');
    });
  });

  describe('GET /api/v1/scans/:scanId/notes', () => {
    it('returns a paginated note list for the Owner', async () => {
      const response = await request(app)
        .get(`/api/v1/scans/${SCAN_ID}/notes`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const body = NoteListResponseSchema.parse(response.body as unknown);

      expect(body.items).toHaveLength(1);
      expect(body.pagination).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
      expect(list).toHaveBeenCalledWith(USER_A, SCAN_ID, {
        page: 1,
        limit: 20,
        sort: 'updatedAt:desc',
      });
    });

    it('returns the list for an active Viewer', async () => {
      const response = await request(app)
        .get(`/api/v1/scans/${SCAN_ID}/notes`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);
      const body = NoteListResponseSchema.parse(response.body as unknown);

      expect(body.items).toHaveLength(1);
      expect(list).toHaveBeenCalledWith(USER_B, SCAN_ID, {
        page: 1,
        limit: 20,
        sort: 'updatedAt:desc',
      });
    });

    it('passes page, limit, and sort', async () => {
      await request(app)
        .get(`/api/v1/scans/${SCAN_ID}/notes?page=2&limit=10&sort=createdAt:asc`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      expect(list).toHaveBeenCalledWith(USER_A, SCAN_ID, {
        page: 2,
        limit: 10,
        sort: 'createdAt:asc',
      });
    });

    it('rejects invalid list query', async () => {
      await request(app)
        .get(`/api/v1/scans/${SCAN_ID}/notes?page=0`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(400);
    });

    it('hides list when the scan is inaccessible', async () => {
      list.mockRejectedValueOnce(new ScanNotFoundError());

      const response = await request(app)
        .get(`/api/v1/scans/${SCAN_ID}/notes`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);
      const body = ErrorResponseSchema.parse(response.body as unknown);

      expect(body.error.code).toBe('SCAN_NOT_FOUND');
    });
  });

  describe('GET /api/v1/notes/:noteId', () => {
    it('returns note detail for the Owner', async () => {
      const response = await request(app)
        .get(`/api/v1/notes/${NOTE_ID}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const body = NoteResponseSchema.parse(response.body as unknown);

      expect(body.permissions.role).toBe('OWNER');
      expect(getById).toHaveBeenCalledWith(USER_A, NOTE_ID);
    });

    it('returns note detail for an active Viewer', async () => {
      getById.mockResolvedValueOnce(
        noteResult({
          permissions: { role: 'VIEWER', canView: true, canEdit: false, canDelete: false },
        }),
      );

      const response = await request(app)
        .get(`/api/v1/notes/${NOTE_ID}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);
      const body = NoteResponseSchema.parse(response.body as unknown);

      expect(body.permissions.role).toBe('VIEWER');
    });

    it('returns the same hidden 404 for missing, deleted, or inaccessible notes', async () => {
      getById.mockRejectedValueOnce(new NoteNotFoundError());

      const response = await request(app)
        .get(`/api/v1/notes/${NOTE_ID}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);
      const body = ErrorResponseSchema.parse(response.body as unknown);

      expect(body.error.code).toBe('NOTE_NOT_FOUND');
    });

    it('rejects an invalid note UUID', async () => {
      await request(app)
        .get('/api/v1/notes/not-a-uuid')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(400);
    });
  });

  describe('PATCH /api/v1/notes/:noteId', () => {
    it('updates title, content and color as the Owner', async () => {
      const response = await request(app)
        .patch(`/api/v1/notes/${NOTE_ID}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('If-Match', '"1"')
        .send({ title: 'Updated title', content: 'Updated content', color: 'RED' })
        .expect(200);
      const body = NoteResponseSchema.parse(response.body as unknown);

      expect(body.title).toBe('Updated title');
      expect(body.content).toBe('Updated content');
      expect(update).toHaveBeenCalledWith(USER_A, NOTE_ID, 1, {
        title: 'Updated title',
        content: 'Updated content',
        color: 'RED',
      });
    });

    it('rejects an empty partial update', async () => {
      await request(app)
        .patch(`/api/v1/notes/${NOTE_ID}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({})
        .expect(400);
    });

    it('rejects an invalid color', async () => {
      await request(app)
        .patch(`/api/v1/notes/${NOTE_ID}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ color: 'PINK' })
        .expect(400);
    });

    it('rejects blank content', async () => {
      await request(app)
        .patch(`/api/v1/notes/${NOTE_ID}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ content: '   ' })
        .expect(400);
    });

    it('rejects unknown fields', async () => {
      await request(app)
        .patch(`/api/v1/notes/${NOTE_ID}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ content: 'Updated', position: { x: 1, y: 2, z: 3 } })
        .expect(400);
    });

    it('hides update from a Viewer', async () => {
      update.mockRejectedValueOnce(new NoteNotFoundError());

      const response = await request(app)
        .patch(`/api/v1/notes/${NOTE_ID}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .set('If-Match', '"1"')
        .send({ content: 'Forbidden' })
        .expect(404);
      const body = ErrorResponseSchema.parse(response.body as unknown);

      expect(body.error.code).toBe('NOTE_NOT_FOUND');
    });
  });

  describe('PATCH /api/v1/notes/:noteId/position', () => {
    it('moves a note as the Owner', async () => {
      const response = await request(app)
        .patch(`/api/v1/notes/${NOTE_ID}/position`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('If-Match', '"1"')
        .send({
          position: { x: 9, y: 8, z: 7 },
          orientation: { x: 0, y: 0, z: 1 },
          modelVersion: '1',
        })
        .expect(200);
      const body = NoteResponseSchema.parse(response.body as unknown);

      expect(body.position).toEqual({ x: 9, y: 8, z: 7 });
      expect(move).toHaveBeenCalledWith(USER_A, NOTE_ID, 1, {
        position: { x: 9, y: 8, z: 7 },
        orientation: { x: 0, y: 0, z: 1 },
        modelVersion: '1',
      });
    });

    it('rejects a missing position', async () => {
      await request(app)
        .patch(`/api/v1/notes/${NOTE_ID}/position`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ modelVersion: '1' })
        .expect(400);
    });

    it('rejects a missing modelVersion', async () => {
      await request(app)
        .patch(`/api/v1/notes/${NOTE_ID}/position`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ position: { x: 1, y: 2, z: 3 } })
        .expect(400);
    });

    it('rejects unknown fields', async () => {
      await request(app)
        .patch(`/api/v1/notes/${NOTE_ID}/position`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          position: { x: 1, y: 2, z: 3 },
          modelVersion: '1',
          content: 'Not allowed',
        })
        .expect(400);
    });

    it('hides move from a Viewer', async () => {
      move.mockRejectedValueOnce(new NoteNotFoundError());

      const response = await request(app)
        .patch(`/api/v1/notes/${NOTE_ID}/position`)
        .set('Authorization', `Bearer ${tokenB}`)
        .set('If-Match', '"1"')
        .send({ position: { x: 1, y: 2, z: 3 }, modelVersion: '1' })
        .expect(404);
      const body = ErrorResponseSchema.parse(response.body as unknown);

      expect(body.error.code).toBe('NOTE_NOT_FOUND');
    });

    it('returns 409 for a stale model version', async () => {
      move.mockRejectedValueOnce(new ModelVersionMismatchError());

      const response = await request(app)
        .patch(`/api/v1/notes/${NOTE_ID}/position`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('If-Match', '"1"')
        .send({ position: { x: 1, y: 2, z: 3 }, modelVersion: '2' })
        .expect(409);
      const body = ErrorResponseSchema.parse(response.body as unknown);

      expect(body.error.code).toBe('MODEL_VERSION_MISMATCH');
    });
  });

  describe('DELETE /api/v1/notes/:noteId', () => {
    it('returns 204 for an Owner deletion', async () => {
      await request(app)
        .delete(`/api/v1/notes/${NOTE_ID}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('If-Match', '"1"')
        .expect(204);

      expect(remove).toHaveBeenCalledWith(USER_A, NOTE_ID, 1);
    });

    it('hides deletion from a Viewer or unrelated user', async () => {
      remove.mockRejectedValueOnce(new NoteNotFoundError());

      const response = await request(app)
        .delete(`/api/v1/notes/${NOTE_ID}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .set('If-Match', '"1"')
        .expect(404);
      const body = ErrorResponseSchema.parse(response.body as unknown);

      expect(body.error.code).toBe('NOTE_NOT_FOUND');
    });
  });

  describe('OpenAPI document', () => {
    it('documents all six note operations and Bearer auth', async () => {
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

      expect(body.paths).toHaveProperty('/api/v1/scans/{scanId}/notes');
      expect(body.paths).toHaveProperty('/api/v1/notes/{noteId}');
      expect(body.paths).toHaveProperty('/api/v1/notes/{noteId}/position');
      expect(body.components.securitySchemes).toHaveProperty('BearerAuth');
      expect(JSON.stringify(body.components.schemas.NoteResponse)).toContain('"permissions"');
      expect(JSON.stringify(body.components.schemas.NoteResponse)).toContain('"position"');
    });
  });
});
