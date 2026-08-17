import { Router } from 'express';

import { AppError } from '../../common/errors/app-error.js';
import { authenticate, getUserId } from '../../common/middleware/authenticate.js';
import type {
  AccessTokenVerifier,
  CurrentUserRepository,
} from '../../common/middleware/authenticate.js';
import { validateRequest } from '../../common/middleware/validate-request.js';
import { ProjectNotFoundError } from '../project/project.errors.js';
import { InvalidSyncCursorError, InvalidSyncTimestampError } from './sync.errors.js';
import {
  SyncChangesQuerySchema,
  SyncChangesResponseSchema,
  SyncStatusQuerySchema,
  SyncStatusResponseSchema,
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
  if (error instanceof InvalidSyncCursorError) {
    return new AppError({
      statusCode: 400,
      code: 'INVALID_SYNC_CURSOR',
      message: 'Sync cursor is invalid',
    });
  }
  if (error instanceof InvalidSyncTimestampError) {
    return new AppError({
      statusCode: 400,
      code: 'INVALID_SYNC_TIMESTAMP',
      message: 'Sync timestamp is invalid',
    });
  }
  if (error instanceof ProjectNotFoundError) {
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
        const result = await syncService.getChanges(userId, {
          limit: query.limit,
          ...(query.since === undefined ? {} : { since: query.since }),
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        });
        response.status(200).json(SyncChangesResponseSchema.parse(result));
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
        const result = await syncService.getStatus(userId, query.projectId);
        response.status(200).json(SyncStatusResponseSchema.parse(result));
      } catch (error) {
        next(mapError(error) ?? error);
      }
    },
  );

  return router;
}
