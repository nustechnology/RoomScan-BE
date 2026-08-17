import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { errorHandler } from '../src/common/middleware/error-handler.js';
import { ErrorResponseSchema } from '../src/common/schemas/error.js';
import type {
  AccessTokenVerifier,
  CurrentUserRepository,
} from '../src/common/middleware/authenticate.js';
import { ProjectNotFoundError } from '../src/modules/project/project.errors.js';
import {
  InvalidSyncCursorError,
  InvalidSyncTimestampError,
} from '../src/modules/sync/sync.errors.js';
import { createSyncRouter } from '../src/modules/sync/sync.routes.js';
import type { SyncService } from '../src/modules/sync/sync.service.js';

const USER_ID = 'eb5d278f-c857-45c7-887d-7be65288cb75';
const PROJECT_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';

describe('Sync HTTP endpoints', () => {
  const getChanges = vi.fn<SyncService['getChanges']>();
  const getStatus = vi.fn<SyncService['getStatus']>();
  const syncService = { getChanges, getStatus } as unknown as SyncService;
  const accessTokenVerifier: AccessTokenVerifier = {
    verify: vi.fn((token) => {
      if (token !== 'valid') return Promise.reject(new Error('invalid'));
      return Promise.resolve({ userId: USER_ID });
    }),
  };
  const currentUserRepository: CurrentUserRepository = {
    findById: vi.fn((id: string) => Promise.resolve({ id, email: 'owner@example.com' })),
  };
  const app = express();
  app.use('/api/v1', createSyncRouter({ syncService, accessTokenVerifier, currentUserRepository }));
  app.use(errorHandler);

  beforeEach(() => {
    vi.clearAllMocks();
    getChanges.mockResolvedValue({ changes: [], nextCursor: 'next-cursor' });
    getStatus.mockResolvedValue({ items: [] });
  });

  it('requires authentication for both sync endpoints', async () => {
    await request(app).get('/api/v1/sync/changes').expect(401);
    await request(app).get('/api/v1/sync/status').expect(401);
    expect(getChanges).not.toHaveBeenCalled();
    expect(getStatus).not.toHaveBeenCalled();
  });

  it('applies the default limit and passes cursor queries to the service', async () => {
    await request(app)
      .get('/api/v1/sync/changes?cursor=opaque-cursor')
      .set('Authorization', 'Bearer valid')
      .expect(200, { changes: [], nextCursor: 'next-cursor' });

    expect(getChanges).toHaveBeenCalledWith(USER_ID, {
      cursor: 'opaque-cursor',
      limit: 100,
    });
  });

  it('validates query limits before invoking the service', async () => {
    const response = await request(app)
      .get('/api/v1/sync/changes?limit=501')
      .set('Authorization', 'Bearer valid')
      .expect(400);

    expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe('VALIDATION_ERROR');
    expect(getChanges).not.toHaveBeenCalled();
  });

  it.each([
    [new InvalidSyncCursorError(), 'INVALID_SYNC_CURSOR'],
    [new InvalidSyncTimestampError(), 'INVALID_SYNC_TIMESTAMP'],
  ])('maps sync input errors to stable 400 responses', async (error, code) => {
    getChanges.mockRejectedValueOnce(error);
    const response = await request(app)
      .get('/api/v1/sync/changes')
      .set('Authorization', 'Bearer valid')
      .expect(400);

    expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe(code);
  });

  it('returns one requested accessible status and hides inaccessible projects', async () => {
    getStatus.mockResolvedValueOnce({
      items: [
        {
          projectId: PROJECT_ID,
          syncStatus: 'PENDING',
          pendingCount: 1,
          syncingCount: 0,
          failedCount: 0,
          conflictCount: 0,
          lastSyncedAt: null,
          requiredAssetsUploaded: false,
        },
      ],
    });
    await request(app)
      .get(`/api/v1/sync/status?projectId=${PROJECT_ID}`)
      .set('Authorization', 'Bearer valid')
      .expect(200);
    expect(getStatus).toHaveBeenCalledWith(USER_ID, PROJECT_ID);

    getStatus.mockRejectedValueOnce(new ProjectNotFoundError());
    const response = await request(app)
      .get(`/api/v1/sync/status?projectId=${PROJECT_ID}`)
      .set('Authorization', 'Bearer valid')
      .expect(404);
    expect(ErrorResponseSchema.parse(response.body as unknown).error.code).toBe(
      'PROJECT_NOT_FOUND',
    );
  });
});
