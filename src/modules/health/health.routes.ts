import { Router } from 'express';

import { AppError } from '../../common/errors/app-error.js';
import { APP_NAME, APP_VERSION } from '../../config/constants.js';
import type { DatabaseHealth } from '../../infrastructure/database/database.js';
import { HealthResponseSchema, ReadinessResponseSchema } from './health.schemas.js';

export interface HealthRouterDependencies {
  database: DatabaseHealth;
  clock?: () => Date;
}

export function createHealthRouter({
  database,
  clock = () => new Date(),
}: HealthRouterDependencies): Router {
  const router = Router();

  router.get('/health', (_request, response) => {
    const body = HealthResponseSchema.parse({
      status: 'ok',
      service: APP_NAME,
      version: APP_VERSION,
      timestamp: clock().toISOString(),
    });

    response.status(200).json(body);
  });

  router.get('/ready', async (_request, response, next) => {
    try {
      await database.checkConnection();

      const body = ReadinessResponseSchema.parse({
        status: 'ok',
        service: APP_NAME,
        version: APP_VERSION,
        timestamp: clock().toISOString(),
        database: 'up',
      });

      response.status(200).json(body);
    } catch (error) {
      next(
        new AppError({
          statusCode: 503,
          code: 'SERVICE_UNAVAILABLE',
          message: 'Database is unavailable',
          cause: error,
        }),
      );
    }
  });

  return router;
}
