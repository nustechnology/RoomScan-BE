import { Router } from 'express';

import { AppError } from '../../common/errors/app-error.js';
import { authenticate, getUserId } from '../../common/middleware/authenticate.js';
import type {
  AccessTokenVerifier,
  CurrentUserRepository,
} from '../../common/middleware/authenticate.js';
import { validateRequest } from '../../common/middleware/validate-request.js';
import { InvalidCursorError, SyncProjectNotFoundError } from './sync.errors.js';
import {
  SyncChangesQuerySchema,
  SyncChangesResponseSchema,
  SyncProjectStatusSchema,
  SyncStatusListResponseSchema,
  SyncStatusQuerySchema,
  type SyncChangesQuery,
  type SyncStatusQuery,
} from './sync.schemas.js';
import type { SyncService } from './sync.service.js';

export interface SyncRouterDependencies {
  syncService: SyncService;
  accessTokenVerifier: AccessTokenVerifier;
  currentUserRepository: CurrentUserRepository;
}

function mapError(error: unknown): AppError | undefined {
  if (error instanceof InvalidCursorError) {
    return new AppError({
      statusCode: 400,
      code: 'INVALID_CURSOR',
      message: 'Sync cursor is invalid or expired',
    });
  }
  if (error instanceof SyncProjectNotFoundError) {
    return new AppError({
      statusCode: 404,
      code: 'PROJECT_NOT_FOUND',
      message: 'Project was not found',
    });
  }
  return undefined;
}

export function createSyncRouter({
  syncService,
  accessTokenVerifier,
  currentUserRepository,
}: SyncRouterDependencies): Router {
  const router = Router();
  const requireAuth = authenticate(accessTokenVerifier, currentUserRepository);

  router.get(
    '/sync/changes',
    requireAuth,
    validateRequest({ query: SyncChangesQuerySchema }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { query } = response.locals.validated as { query: SyncChangesQuery };
        const result = await syncService.listChanges(userId, {
          ...(query.since === undefined ? {} : { since: new Date(query.since) }),
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          limit: query.limit,
        });
        const responseBody = SyncChangesResponseSchema.parse(result);

        response.status(200).json(responseBody);
      } catch (error) {
        next(mapError(error) ?? error);
      }
    },
  );

  router.get(
    '/sync/status',
    requireAuth,
    validateRequest({ query: SyncStatusQuerySchema }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { query } = response.locals.validated as { query: SyncStatusQuery };

        if (query.projectId === undefined) {
          const result = await syncService.listStatus(userId);
          const responseBody = SyncStatusListResponseSchema.parse({ items: result });

          response.status(200).json(responseBody);
          return;
        }

        const result = await syncService.getProjectStatus(userId, query.projectId);
        const responseBody = SyncProjectStatusSchema.parse(result);

        response.status(200).json(responseBody);
      } catch (error) {
        next(mapError(error) ?? error);
      }
    },
  );

  return router;
}
