import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { errorHandler } from '../src/common/middleware/error-handler.js';
import type {
  AccessTokenVerifier,
  CurrentUserRepository,
} from '../src/common/middleware/authenticate.js';
import type { UserProfileService } from '../src/modules/users/users.service.js';
import {
  GetMeResponseSchema,
  UserProfileResponseSchema,
} from '../src/modules/users/users.schemas.js';
import { UserNotFoundError } from '../src/modules/users/users.errors.js';
import { createUsersRouter } from '../src/modules/users/users.routes.js';

const USER_ID = 'eb5d278f-c857-45c7-887d-7be65288cb75';
const PUBLIC_USER_ID = 'GP5HS2WKBE';

function buildApp() {
  const getMe = vi.fn<UserProfileService['getMe']>();
  const updateMe = vi.fn<UserProfileService['updateMe']>();
  const service = {
    getMe,
    updateMe,
  } as unknown as UserProfileService;
  const accessTokenVerifier: AccessTokenVerifier = {
    verify: vi.fn().mockResolvedValue({ userId: USER_ID }),
  };
  const findById = vi.fn<CurrentUserRepository['findById']>().mockResolvedValue({
    id: USER_ID,
    publicUserId: PUBLIC_USER_ID,
    email: 'owner@example.com',
    displayName: null,
  });
  const currentUserRepository: CurrentUserRepository = {
    findById,
    updateDisplayName: vi.fn(),
  };
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(
    '/api/v1',
    createUsersRouter({ userProfileService: service, accessTokenVerifier, currentUserRepository }),
  );
  app.use(errorHandler);
  return { app, getMe, updateMe };
}

describe('users router', () => {
  it('requires authentication for get and patch', async () => {
    const { app } = buildApp();
    await request(app).get('/api/v1/users/me').expect(401);
    await request(app).patch('/api/v1/users/me').send({ displayName: 'Name' }).expect(401);
  });

  it('returns the current user email and displayName', async () => {
    const { app, getMe } = buildApp();
    getMe.mockResolvedValue({
      publicUserId: PUBLIC_USER_ID,
      email: 'owner@example.com',
      displayName: 'Nguyen Minh Anh',
    });
    const response = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', 'Bearer token')
      .expect(200);
    const body = GetMeResponseSchema.parse(response.body as unknown);
    expect(body).toEqual({
      publicUserId: PUBLIC_USER_ID,
      email: 'owner@example.com',
      displayName: 'Nguyen Minh Anh',
    });
    expect(getMe).toHaveBeenCalledWith(USER_ID);
  });

  it('updates the current user displayName', async () => {
    const { app, updateMe } = buildApp();
    updateMe.mockResolvedValue({
      id: USER_ID,
      publicUserId: PUBLIC_USER_ID,
      email: 'owner@example.com',
      displayName: 'Nguyen Minh Anh',
      provider: 'apple',
    });
    const response = await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', 'Bearer token')
      .send({ displayName: 'Nguyen Minh Anh' })
      .expect(200);
    const body = UserProfileResponseSchema.parse(response.body as unknown);
    expect(body).toEqual({
      id: USER_ID,
      publicUserId: PUBLIC_USER_ID,
      email: 'owner@example.com',
      displayName: 'Nguyen Minh Anh',
      provider: 'apple',
    });
    expect(updateMe).toHaveBeenCalledWith(USER_ID, { displayName: 'Nguyen Minh Anh' });
  });

  it('allows clearing the displayName with null', async () => {
    const { app, updateMe } = buildApp();
    updateMe.mockResolvedValue({
      id: USER_ID,
      publicUserId: PUBLIC_USER_ID,
      email: 'owner@example.com',
      displayName: null,
      provider: 'apple',
    });
    await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', 'Bearer token')
      .send({ displayName: null })
      .expect(200);
    expect(updateMe).toHaveBeenCalledWith(USER_ID, { displayName: null });
  });

  it('rejects an empty or unknown payload with 400', async () => {
    const { app, updateMe } = buildApp();
    await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', 'Bearer token')
      .send({})
      .expect(400);
    await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', 'Bearer token')
      .send({ displayName: '' })
      .expect(400);
    await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', 'Bearer token')
      .send({ displayName: 'Name', unexpected: true })
      .expect(400);
    expect(updateMe).not.toHaveBeenCalled();
  });

  it('returns 404 when the current user no longer exists', async () => {
    const { app, updateMe } = buildApp();
    updateMe.mockRejectedValue(new UserNotFoundError());
    const response = await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', 'Bearer token')
      .send({ displayName: 'Name' })
      .expect(404);
    expect((response.body as { error: { code: string } }).error.code).toBe('USER_NOT_FOUND');
  });

  it('returns 404 when getMe cannot find the current user', async () => {
    const { app, getMe } = buildApp();
    getMe.mockRejectedValue(new UserNotFoundError());
    const response = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', 'Bearer token')
      .expect(404);
    expect((response.body as { error: { code: string } }).error.code).toBe('USER_NOT_FOUND');
  });
});
