import { randomUUID } from 'node:crypto';

import compression from 'compression';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import type { StdSerializedResults } from 'pino-http';
import swaggerUi from 'swagger-ui-express';

import { errorHandler } from './common/middleware/error-handler.js';
import { notFoundHandler } from './common/middleware/not-found.js';
import type { RateLimiters } from './common/middleware/rate-limit.js';
import type {
  AccessTokenVerifier,
  CurrentUserRepository,
} from './common/middleware/authenticate.js';
import { API_DOC_PATH, API_PREFIX } from './config/constants.js';
import type { AppConfig } from './config/env.js';
import type { DatabaseHealth } from './infrastructure/database/database.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import type { AppleAuthService, TokenRefreshService } from './modules/auth/auth.types.js';
import { createHealthRouter } from './modules/health/health.routes.js';
import { createProjectRouter } from './modules/project/project.routes.js';
import type { ProjectService } from './modules/project/project.service.js';
import { createScanRouter } from './modules/scan/scan.routes.js';
import type { ScanService } from './modules/scan/scan.service.js';
import { createScanAssetRouter } from './modules/scan-asset/scan-asset.routes.js';
import type { ScanAssetService } from './modules/scan-asset/scan-asset.service.js';
import { createNoteRouter } from './modules/note/note.routes.js';
import type { NoteService } from './modules/note/note.service.js';
import { createShareRouter } from './modules/share/share.routes.js';
import type { ShareLinkService } from './modules/share/share-link.service.js';
import type { ShareService } from './modules/share/share.service.js';
import { createSharedProjectsRouter } from './modules/shared-projects/shared-projects.routes.js';
import type { SharedProjectsService } from './modules/shared-projects/shared-projects.service.js';
import { createSharedScansRouter } from './modules/shared-scans/shared-scans.routes.js';
import type { SharedScansService } from './modules/shared-scans/shared-scans.service.js';
import { createWellKnownRouter } from './modules/well-known/well-known.routes.js';
import { createOpenApiDocument } from './openapi/document.js';

export interface AppDependencies {
  config: AppConfig;
  database: DatabaseHealth;
  logger: Logger;
  authService: AppleAuthService;
  refreshTokenService: TokenRefreshService;
  projectService: ProjectService;
  scanService: ScanService;
  scanAssetService: ScanAssetService;
  noteService: NoteService;
  shareService: ShareService;
  shareLinkService: ShareLinkService;
  sharedProjectsService: SharedProjectsService;
  sharedScansService: SharedScansService;
  accessTokenVerifier: AccessTokenVerifier;
  currentUserRepository: CurrentUserRepository;
  rateLimiters: RateLimiters;
  clock?: () => Date;
}

const INVITATION_TOKEN_PATTERN = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/gi;

export function redactInvitationToken(value: string): string {
  return value.replace(INVITATION_TOKEN_PATTERN, '[REDACTED]');
}

function redactTokenFields(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      typeof entry === 'string' ? redactInvitationToken(entry) : entry,
    ]),
  );
}

export function createApp({
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
  clock,
}: AppDependencies): Express {
  const app = express();
  const openApiDocument = createOpenApiDocument();

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(
    pinoHttp({
      logger,
      genReqId(request, response) {
        const incomingRequestId = request.headers['x-request-id'];
        const requestId =
          typeof incomingRequestId === 'string' && incomingRequestId.length > 0
            ? incomingRequestId
            : randomUUID();

        response.setHeader('x-request-id', requestId);
        return requestId;
      },
      serializers: {
        req(request: StdSerializedResults['req']) {
          return {
            ...request,
            url: redactInvitationToken(request.url ?? ''),
            ...(request.query === undefined ? {} : { query: redactTokenFields(request.query) }),
            ...(request.params === undefined ? {} : { params: redactTokenFields(request.params) }),
          };
        },
      },
    }),
  );
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
        },
      },
    }),
  );
  app.use(
    cors({
      origin: config.corsOrigins,
      credentials: config.corsOrigins !== '*',
      exposedHeaders: ['RateLimit', 'RateLimit-Policy', 'Retry-After'],
    }),
  );
  app.use(compression());
  app.use(API_PREFIX, rateLimiters.api);
  app.use(`${API_PREFIX}/auth/apple`, rateLimiters.appleAuth);
  app.use(`${API_PREFIX}/auth/refresh`, rateLimiters.refreshAuth);
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  app.get(`${API_DOC_PATH}.json`, (_request, response) => {
    response.status(200).json(openApiDocument);
  });
  app.use(
    API_DOC_PATH,
    swaggerUi.serve,
    swaggerUi.setup(openApiDocument, {
      customSiteTitle: 'RoomScan API',
      swaggerOptions: {
        displayRequestDuration: true,
      },
    }),
  );

  app.use(
    API_PREFIX,
    createAuthRouter({
      authService,
      refreshTokenService,
    }),
  );
  app.use(
    API_PREFIX,
    createProjectRouter({
      projectService,
      accessTokenVerifier,
      currentUserRepository,
    }),
  );
  app.use(
    API_PREFIX,
    createScanRouter({
      scanService,
      scanAssetService,
      accessTokenVerifier,
      currentUserRepository,
    }),
  );
  app.use(
    API_PREFIX,
    createScanAssetRouter({
      scanAssetService,
      accessTokenVerifier,
      currentUserRepository,
    }),
  );
  app.use(
    API_PREFIX,
    createNoteRouter({
      noteService,
      accessTokenVerifier,
      currentUserRepository,
    }),
  );
  app.use(
    API_PREFIX,
    createShareRouter({
      shareService,
      shareLinkService,
      accessTokenVerifier,
      currentUserRepository,
    }),
  );
  app.use(
    API_PREFIX,
    createSharedProjectsRouter({
      sharedProjectsService,
      accessTokenVerifier,
      currentUserRepository,
    }),
  );
  app.use(
    API_PREFIX,
    createSharedScansRouter({
      sharedScansService,
      accessTokenVerifier,
      currentUserRepository,
    }),
  );
  app.use(
    API_PREFIX,
    createHealthRouter({
      database,
      ...(clock === undefined ? {} : { clock }),
    }),
  );

  app.use(createWellKnownRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
