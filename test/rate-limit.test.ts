import pino from 'pino';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { Store } from 'express-rate-limit';

import { createApp } from '../src/app.js';
import type {
  AccessTokenVerifier,
  CurrentUserRepository,
} from '../src/common/middleware/authenticate.js';
import { createRateLimiters, type RateLimitStores } from '../src/common/middleware/rate-limit.js';
import { ErrorResponseSchema } from '../src/common/schemas/error.js';
import type { AppConfig } from '../src/config/env.js';
import type { AppleAuthService, TokenRefreshService } from '../src/modules/auth/auth.types.js';
import type { ProjectService } from '../src/modules/project/project.service.js';
import type { ScanService } from '../src/modules/scan/scan.service.js';
import type { ScanAssetService } from '../src/modules/scan-asset/scan-asset.service.js';
import type { NoteService } from '../src/modules/note/note.service.js';

const baseConfig: AppConfig = {
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
};

function createTestApp(overrides: Partial<AppConfig> = {}, stores: RateLimitStores = {}) {
  const config: AppConfig = {
    ...baseConfig,
    ...overrides,
  };
  const logger = pino({ enabled: false });
  const signInWithApple = vi.fn<AppleAuthService['signInWithApple']>();
  signInWithApple.mockResolvedValue({
    accessToken: 'roomscan-access-token',
    refreshToken: 'roomscan-refresh-token',
    user: {
      id: 'eb5d278f-c857-45c7-887d-7be65288cb75',
      email: 'user@example.com',
      provider: 'apple',
    },
  });
  const authService: AppleAuthService = {
    signInWithApple,
  };
  const refreshTokenService: TokenRefreshService = {
    refresh: vi.fn(),
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
  const rateLimiters = createRateLimiters(config, logger, stores);
  const app = createApp({
    config,
    database: {
      checkConnection: vi.fn(() => Promise.resolve()),
      disconnect: vi.fn(() => Promise.resolve()),
    },
    logger,
    authService,
    refreshTokenService,
    projectService,
    scanService,
    scanAssetService,
    noteService,
    accessTokenVerifier,
    currentUserRepository,
    rateLimiters,
  });

  return {
    app,
    logger,
    signInWithApple,
  };
}

function signIn(app: ReturnType<typeof createTestApp>['app'], ip?: string) {
  const pendingRequest = request(app)
    .post('/api/v1/auth/apple')
    .send({ identityToken: 'apple-identity-token' });

  if (ip !== undefined) {
    pendingRequest.set('x-forwarded-for', ip);
  }

  return pendingRequest;
}

describe('rate limiting', () => {
  it('enforces the general API policy before the Apple policy', async () => {
    const { app, signInWithApple } = createTestApp({
      apiRateLimitMaxRequests: 1,
      appleAuthRateLimitMaxRequests: 10,
    });

    await signIn(app).expect(200);
    const response = await signIn(app).set('x-request-id', 'global-rate-limit-request').expect(429);
    const body = ErrorResponseSchema.parse(response.body as unknown);

    expect(body).toEqual({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests; please try again later',
      },
      requestId: 'global-rate-limit-request',
    });
    expect(response.headers.ratelimit).toContain('"api"');
    expect(response.headers['ratelimit-policy']).toContain('"api"');
    expect(response.headers['retry-after']).toEqual(expect.any(String));
    expect(response.headers['x-request-id']).toBe('global-rate-limit-request');
    expect(response.headers['x-ratelimit-limit']).toBeUndefined();
    expect(signInWithApple).toHaveBeenCalledOnce();
    expect(JSON.stringify(body)).not.toContain('apple-identity-token');
  });

  it('enforces the Apple policy independently from the general API policy', async () => {
    const { app, signInWithApple } = createTestApp({
      apiRateLimitMaxRequests: 10,
      appleAuthRateLimitMaxRequests: 1,
    });

    const firstResponse = await signIn(app).expect(200);
    const blockedResponse = await signIn(app).expect(429);

    expect(firstResponse.headers.ratelimit).toContain('"api"');
    expect(firstResponse.headers.ratelimit).toContain('"auth-apple"');
    expect(firstResponse.headers['ratelimit-policy']).toContain('"api"');
    expect(firstResponse.headers['ratelimit-policy']).toContain('"auth-apple"');
    expect(blockedResponse.headers.ratelimit).toContain('"auth-apple"');
    expect(blockedResponse.headers['retry-after']).toEqual(expect.any(String));
    expect(signInWithApple).toHaveBeenCalledOnce();
  });

  it('counts Apple request validation failures against the Apple policy', async () => {
    const { app, signInWithApple } = createTestApp({
      apiRateLimitMaxRequests: 10,
      appleAuthRateLimitMaxRequests: 1,
    });

    await request(app).post('/api/v1/auth/apple').send({}).expect(400);
    await signIn(app).expect(429);

    expect(signInWithApple).not.toHaveBeenCalled();
  });

  it('counts Apple malformed-JSON requests against the Apple policy', async () => {
    const { app, signInWithApple } = createTestApp({
      apiRateLimitMaxRequests: 10,
      appleAuthRateLimitMaxRequests: 1,
    });

    await request(app)
      .post('/api/v1/auth/apple')
      .set('content-type', 'application/json')
      .send('{"broken":')
      .expect(400);
    await signIn(app).expect(429);

    expect(signInWithApple).not.toHaveBeenCalled();
  });

  it('does not limit health, readiness, Swagger, or OpenAPI', async () => {
    const { app } = createTestApp({
      apiRateLimitMaxRequests: 1,
    });

    for (let index = 0; index < 3; index += 1) {
      await request(app).get('/api/v1/health').expect(200);
      await request(app).get('/api/v1/ready').expect(200);
      await request(app).get('/api-doc/').expect(200);
      await request(app).get('/api-doc.json').expect(200);
    }
  });

  it('keeps separate quotas for different client IP addresses', async () => {
    const { app, signInWithApple } = createTestApp({
      trustProxy: 1,
      apiRateLimitMaxRequests: 10,
      appleAuthRateLimitMaxRequests: 1,
    });

    await signIn(app, '198.51.100.10').expect(200);
    await signIn(app, '198.51.100.11').expect(200);

    expect(signInWithApple).toHaveBeenCalledTimes(2);
  });

  it('groups IPv6 addresses from the same /56 subnet', async () => {
    const { app, signInWithApple } = createTestApp({
      trustProxy: 1,
      apiRateLimitMaxRequests: 10,
      appleAuthRateLimitMaxRequests: 1,
    });

    await signIn(app, '2001:db8:abcd:1201::1').expect(200);
    await signIn(app, '2001:db8:abcd:12ff::2').expect(429);
    await signIn(app, '2001:db8:abcd:1301::1').expect(200);

    expect(signInWithApple).toHaveBeenCalledTimes(2);
  });

  it('fails open and logs when the rate-limit store is unavailable', async () => {
    const failingStore: Store = {
      increment: vi.fn(() => Promise.reject(new Error('store unavailable'))),
      decrement: vi.fn(),
      resetKey: vi.fn(),
    };
    const { app, logger, signInWithApple } = createTestApp(
      {},
      {
        api: failingStore,
      },
    );
    const logError = vi.spyOn(logger, 'error');

    await signIn(app).expect(200);

    expect(signInWithApple).toHaveBeenCalledOnce();
    expect(logError).toHaveBeenCalledOnce();
    const loggedMessage: unknown = logError.mock.calls[0]?.[1];
    expect(typeof loggedMessage).toBe('string');
    if (typeof loggedMessage === 'string') {
      expect(loggedMessage).toContain('allowing request');
    }
  });
});
