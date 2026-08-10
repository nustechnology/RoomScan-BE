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
import type { AppConfig } from '../src/config/env.js';
import type { DatabaseHealth } from '../src/infrastructure/database/database.js';
import {
  AppleIdentityProviderUnavailableError,
  InvalidAppleIdentityTokenError,
  InvalidRefreshTokenError,
} from '../src/modules/auth/auth.errors.js';
import {
  AppleSignInResponseSchema,
  RefreshTokenResponseSchema,
} from '../src/modules/auth/auth.schemas.js';
import type { AppleAuthService, TokenRefreshService } from '../src/modules/auth/auth.types.js';
import {
  HealthResponseSchema,
  ReadinessResponseSchema,
} from '../src/modules/health/health.schemas.js';
import type { ProjectService } from '../src/modules/project/project.service.js';
import type { ScanService } from '../src/modules/scan/scan.service.js';
import type { ScanAssetService } from '../src/modules/scan-asset/scan-asset.service.js';
import type { NoteService } from '../src/modules/note/note.service.js';
import type { ShareService } from '../src/modules/share/share.service.js';

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
  appleAuthRateLimitMaxRequests: 500,
  refreshAuthRateLimitWindowSeconds: 900,
  refreshAuthRateLimitMaxRequests: 10,
  appleClientId: 'com.example.roomscan',
  accessTokenSecret: 'access-secret-that-is-at-least-32-characters',
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

const clock = () => new Date('2026-07-23T07:00:00.000Z');

describe('RoomScan HTTP application', () => {
  const checkConnection = vi.fn(() => Promise.resolve());
  const disconnect = vi.fn(() => Promise.resolve());
  const database: DatabaseHealth = {
    checkConnection,
    disconnect,
  };
  const logger = pino({ enabled: false });
  const rateLimiters = createRateLimiters(config, logger);
  const signInWithApple = vi.fn<AppleAuthService['signInWithApple']>();
  const authService: AppleAuthService = {
    signInWithApple,
  };
  const refreshTokenMock = vi.fn<TokenRefreshService['refresh']>();
  const refreshTokenService: TokenRefreshService = {
    refresh: refreshTokenMock,
  };
  const accessTokenVerifier: AccessTokenVerifier = {
    verify: vi.fn().mockResolvedValue({ userId: 'eb5d278f-c857-45c7-887d-7be65288cb75' }),
  };
  const currentUserRepository: CurrentUserRepository = {
    findById: vi.fn().mockResolvedValue({
      id: 'eb5d278f-c857-45c7-887d-7be65288cb75',
      email: 'user@example.com',
    }),
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
    clock,
  });

  beforeEach(() => {
    checkConnection.mockResolvedValue(undefined);
    signInWithApple.mockResolvedValue({
      accessToken: 'roomscan-access-token',
      refreshToken: 'roomscan-refresh-token',
      user: {
        id: 'eb5d278f-c857-45c7-887d-7be65288cb75',
        email: 'user@example.com',
        provider: 'apple',
      },
    });
    refreshTokenMock.mockResolvedValue({
      accessToken: 'roomscan-new-access-token',
      refreshToken: 'roomscan-new-refresh-token',
    });
  });

  it('returns liveness without checking the database', async () => {
    const response = await request(app).get('/api/v1/health').expect(200);
    const body = HealthResponseSchema.parse(response.body as unknown);

    expect(body).toEqual({
      status: 'ok',
      service: 'RoomScan',
      version: '0.1.0',
      timestamp: '2026-07-23T07:00:00.000Z',
    });
    expect(checkConnection).not.toHaveBeenCalled();
    expect(response.headers['x-request-id']).toEqual(expect.any(String));
  });

  it('uses the system clock when no clock dependency is supplied', async () => {
    const defaultClockApp = createApp({
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
    });
    const response = await request(defaultClockApp).get('/api/v1/health').expect(200);
    const body = HealthResponseSchema.parse(response.body as unknown);

    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
  });

  it('preserves an incoming request ID', async () => {
    const response = await request(app)
      .get('/api/v1/health')
      .set('x-request-id', 'roomscan-test-request')
      .expect(200);

    expect(response.headers['x-request-id']).toBe('roomscan-test-request');
  });

  it('returns readiness when PostgreSQL is reachable', async () => {
    const response = await request(app).get('/api/v1/ready').expect(200);
    const body = ReadinessResponseSchema.parse(response.body as unknown);

    expect(checkConnection).toHaveBeenCalledOnce();
    expect(body).toEqual({
      status: 'ok',
      service: 'RoomScan',
      version: '0.1.0',
      timestamp: '2026-07-23T07:00:00.000Z',
      database: 'up',
    });
  });

  it('returns a safe 503 response when PostgreSQL is unavailable', async () => {
    checkConnection.mockRejectedValueOnce(new Error('password=do-not-expose'));

    const response = await request(app).get('/api/v1/ready').expect(503);
    const body = ErrorResponseSchema.parse(response.body as unknown);

    expect(body.error).toEqual({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Database is unavailable',
    });
    expect(body.requestId).toEqual(expect.any(String));
    expect(JSON.stringify(body)).not.toContain('do-not-expose');
  });

  it('returns the generated OpenAPI 3.1 document', async () => {
    const response = await request(app).get('/api-doc.json').expect(200);
    const body = z
      .object({
        openapi: z.literal('3.1.0'),
        info: z.object({
          title: z.string(),
          version: z.string(),
        }),
        paths: z.record(z.string(), z.unknown()),
      })
      .parse(response.body as unknown);

    expect(body.openapi).toBe('3.1.0');
    expect(body.info).toMatchObject({
      title: 'RoomScan API',
      version: '0.1.0',
    });
    expect(body.paths).toHaveProperty('/api/v1/health');
    expect(body.paths).toHaveProperty('/api/v1/ready');
    expect(body.paths).toHaveProperty('/api/v1/auth/apple');
    const authPath = z
      .object({
        post: z.object({
          responses: z.record(z.string(), z.unknown()),
        }),
      })
      .parse(body.paths['/api/v1/auth/apple']);

    expect(Object.keys(authPath.post.responses)).toEqual(
      expect.arrayContaining(['200', '400', '401', '429', '500', '503']),
    );
    const rateLimitResponse = z
      .object({
        headers: z.object({
          RateLimit: z.unknown(),
          'RateLimit-Policy': z.unknown(),
          'Retry-After': z.unknown(),
        }),
      })
      .parse(authPath.post.responses['429']);

    expect(Object.keys(rateLimitResponse.headers)).toEqual([
      'RateLimit',
      'RateLimit-Policy',
      'Retry-After',
    ]);
  });

  it('serves the Swagger UI', async () => {
    const response = await request(app).get('/api-doc/').expect(200);

    expect(response.text).toContain('RoomScan API');
    expect(response.text).toContain('swagger-ui');
  });

  it('returns the standard error envelope for an unknown route', async () => {
    const response = await request(app)
      .get('/missing')
      .set('x-request-id', 'missing-route-request')
      .expect(404);
    const body = ErrorResponseSchema.parse(response.body as unknown);

    expect(body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Route GET /missing was not found',
      },
      requestId: 'missing-route-request',
    });
  });

  it('returns a safe bad-request response for malformed JSON', async () => {
    const response = await request(app)
      .post('/api/v1/health')
      .set('content-type', 'application/json')
      .send('{"broken":')
      .expect(400);
    const body = ErrorResponseSchema.parse(response.body as unknown);

    expect(body.error).toEqual({
      code: 'BAD_REQUEST',
      message: 'Invalid request payload',
    });
    expect(body.requestId).toEqual(expect.any(String));
  });

  it('authenticates with an Apple identity token', async () => {
    const response = await request(app)
      .post('/api/v1/auth/apple')
      .set('x-request-id', 'apple-auth-request')
      .send({ identityToken: 'apple-identity-token' })
      .expect(200);
    const body = AppleSignInResponseSchema.parse(response.body as unknown);

    expect(signInWithApple).toHaveBeenCalledWith('apple-identity-token', undefined);
    expect(body).toEqual({
      accessToken: 'roomscan-access-token',
      refreshToken: 'roomscan-refresh-token',
      user: {
        id: 'eb5d278f-c857-45c7-887d-7be65288cb75',
        email: 'user@example.com',
        provider: 'apple',
      },
    });
    expect(response.headers['x-request-id']).toBe('apple-auth-request');
    expect(response.headers.ratelimit).toContain('"api"');
    expect(response.headers.ratelimit).toContain('"auth-apple"');
    expect(response.headers['ratelimit-policy']).toContain('"api"');
    expect(response.headers['ratelimit-policy']).toContain('"auth-apple"');
    expect(response.headers['x-ratelimit-limit']).toBeUndefined();
  });

  it('authenticates with an Apple identity token and nonce', async () => {
    const response = await request(app)
      .post('/api/v1/auth/apple')
      .set('x-request-id', 'apple-auth-nonce-request')
      .send({ identityToken: 'apple-identity-token', nonce: 'client-nonce' })
      .expect(200);
    const body = AppleSignInResponseSchema.parse(response.body as unknown);

    expect(signInWithApple).toHaveBeenCalledWith('apple-identity-token', 'client-nonce');
    expect(body).toEqual({
      accessToken: 'roomscan-access-token',
      refreshToken: 'roomscan-refresh-token',
      user: {
        id: 'eb5d278f-c857-45c7-887d-7be65288cb75',
        email: 'user@example.com',
        provider: 'apple',
      },
    });
    expect(response.headers['x-request-id']).toBe('apple-auth-nonce-request');
  });

  it('exposes standard rate-limit headers through CORS', async () => {
    const response = await request(app)
      .post('/api/v1/auth/apple')
      .set('origin', 'https://app.roomscan.dev')
      .send({ identityToken: 'apple-identity-token' })
      .expect(200);

    expect(response.headers['access-control-expose-headers']).toBe(
      'RateLimit,RateLimit-Policy,Retry-After',
    );
  });

  it('rejects a missing Apple identity token', async () => {
    const response = await request(app).post('/api/v1/auth/apple').send({}).expect(400);
    const body = ErrorResponseSchema.parse(response.body as unknown);

    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(signInWithApple).not.toHaveBeenCalled();
  });

  it('rejects an invalid Apple identity token without exposing verification details', async () => {
    signInWithApple.mockRejectedValueOnce(new InvalidAppleIdentityTokenError());

    const response = await request(app)
      .post('/api/v1/auth/apple')
      .send({ identityToken: 'invalid-token' })
      .expect(401);
    const body = ErrorResponseSchema.parse(response.body as unknown);

    expect(body.error).toEqual({
      code: 'INVALID_APPLE_IDENTITY_TOKEN',
      message: 'Apple identity token is invalid',
    });
    expect(JSON.stringify(body)).not.toContain('invalid-token');
  });

  it('rejects an invalid nonce binding without exposing token or nonce details', async () => {
    signInWithApple.mockRejectedValueOnce(new InvalidAppleIdentityTokenError());

    const response = await request(app)
      .post('/api/v1/auth/apple')
      .send({ identityToken: 'signed-apple-token', nonce: 'raw-client-nonce' })
      .expect(401);
    const body = ErrorResponseSchema.parse(response.body as unknown);

    expect(signInWithApple).toHaveBeenCalledWith('signed-apple-token', 'raw-client-nonce');
    expect(body.error).toEqual({
      code: 'INVALID_APPLE_IDENTITY_TOKEN',
      message: 'Apple identity token is invalid',
    });
    expect(JSON.stringify(body)).not.toContain('signed-apple-token');
    expect(JSON.stringify(body)).not.toContain('raw-client-nonce');
  });

  it('reports Apple identity services as unavailable', async () => {
    signInWithApple.mockRejectedValueOnce(new AppleIdentityProviderUnavailableError());

    const response = await request(app)
      .post('/api/v1/auth/apple')
      .send({ identityToken: 'valid-format-token' })
      .expect(503);
    const body = ErrorResponseSchema.parse(response.body as unknown);

    expect(body.error).toEqual({
      code: 'APPLE_IDENTITY_PROVIDER_UNAVAILABLE',
      message: 'Apple identity provider is unavailable',
    });
  });

  it('returns a safe internal error when authentication fails unexpectedly', async () => {
    signInWithApple.mockRejectedValueOnce(new Error('secret=do-not-expose'));

    const response = await request(app)
      .post('/api/v1/auth/apple')
      .send({ identityToken: 'valid-format-token' })
      .expect(500);
    const body = ErrorResponseSchema.parse(response.body as unknown);

    expect(body.error).toEqual({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
    });
    expect(JSON.stringify(body)).not.toContain('do-not-expose');
  });

  it('refreshes a valid refresh token and returns a new pair', async () => {
    const response = await request(app)
      .post('/api/v1/auth/refresh')
      .set('x-request-id', 'refresh-request')
      .send({ refreshToken: 'roomscan-refresh-token' })
      .expect(200);
    const body = RefreshTokenResponseSchema.parse(response.body as unknown);

    expect(refreshTokenMock).toHaveBeenCalledWith('roomscan-refresh-token');
    expect(body).toEqual({
      accessToken: 'roomscan-new-access-token',
      refreshToken: 'roomscan-new-refresh-token',
    });
    expect(response.headers['x-request-id']).toBe('refresh-request');
    expect(response.headers.ratelimit).toContain('"api"');
    expect(response.headers.ratelimit).toContain('"auth-refresh"');
    expect(response.headers['ratelimit-policy']).toContain('"api"');
    expect(response.headers['ratelimit-policy']).toContain('"auth-refresh"');
  });

  it('rejects a missing refresh token body', async () => {
    const response = await request(app).post('/api/v1/auth/refresh').send({}).expect(400);
    const body = ErrorResponseSchema.parse(response.body as unknown);

    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(refreshTokenMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid refresh token without exposing token details', async () => {
    refreshTokenMock.mockRejectedValueOnce(new InvalidRefreshTokenError());

    const response = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'invalid-refresh-token' })
      .expect(401);
    const body = ErrorResponseSchema.parse(response.body as unknown);

    expect(body.error).toEqual({
      code: 'INVALID_REFRESH_TOKEN',
      message: 'Refresh token is invalid',
    });
    expect(JSON.stringify(body)).not.toContain('invalid-refresh-token');
  });

  it('returns a safe internal error when token refresh fails unexpectedly', async () => {
    refreshTokenMock.mockRejectedValueOnce(new Error('secret=do-not-expose'));

    const response = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'valid-format-token' })
      .expect(500);
    const body = ErrorResponseSchema.parse(response.body as unknown);

    expect(body.error).toEqual({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
    });
    expect(JSON.stringify(body)).not.toContain('do-not-expose');
  });
});
