import { randomUUID } from 'node:crypto';

import compression from 'compression';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';

import { errorHandler } from './common/middleware/error-handler.js';
import { notFoundHandler } from './common/middleware/not-found.js';
import type { RateLimiters } from './common/middleware/rate-limit.js';
import { API_DOC_PATH, API_PREFIX } from './config/constants.js';
import type { AppConfig } from './config/env.js';
import type { DatabaseHealth } from './infrastructure/database/database.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import type { AppleAuthService } from './modules/auth/auth.types.js';
import { createHealthRouter } from './modules/health/health.routes.js';
import { createOpenApiDocument } from './openapi/document.js';

export interface AppDependencies {
  config: AppConfig;
  database: DatabaseHealth;
  logger: Logger;
  authService: AppleAuthService;
  rateLimiters: RateLimiters;
  clock?: () => Date;
}

export function createApp({
  config,
  database,
  logger,
  authService,
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
    }),
  );
  app.use(
    API_PREFIX,
    createHealthRouter({
      database,
      ...(clock === undefined ? {} : { clock }),
    }),
  );

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
