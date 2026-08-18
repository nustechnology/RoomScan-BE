import { Router } from 'express';

import { AppError } from '../../common/errors/app-error.js';
import { authenticate, getUserId } from '../../common/middleware/authenticate.js';
import type {
  AccessTokenVerifier,
  CurrentUserRepository,
} from '../../common/middleware/authenticate.js';
import { validateRequest } from '../../common/middleware/validate-request.js';
import { ScanNotFoundError } from '../scan/scan.errors.js';
import { NotSharedScanError, SharedScanNotInListError } from './shared-scans.errors.js';
import {
  ListSharedScansQuerySchema,
  SharedScanIdParamSchema,
  SharedScanListResponseSchema,
  SharedScanRemoveResponseSchema,
  SharedScanResponseSchema,
  type ListSharedScansQuery,
} from './shared-scans.schemas.js';
import type { SharedScansService } from './shared-scans.service.js';

export interface SharedScansRouterDependencies {
  sharedScansService: SharedScansService;
  accessTokenVerifier: AccessTokenVerifier;
  currentUserRepository: CurrentUserRepository;
}

function mapError(error: unknown): AppError | undefined {
  if (error instanceof ScanNotFoundError) {
    return new AppError({
      statusCode: 404,
      code: 'SCAN_NOT_FOUND',
      message: 'Scan was not found',
    });
  }
  if (error instanceof NotSharedScanError) {
    return new AppError({
      statusCode: 403,
      code: 'NOT_SHARED_SCAN',
      message: 'This scan is not shared with you',
    });
  }
  if (error instanceof SharedScanNotInListError) {
    return new AppError({
      statusCode: 409,
      code: 'NOT_IN_SHARED_WITH_ME',
      message: 'This scan is not in your Shared With Me list',
    });
  }
  return undefined;
}

export function createSharedScansRouter({
  sharedScansService,
  accessTokenVerifier,
  currentUserRepository,
}: SharedScansRouterDependencies): Router {
  const router = Router();
  const requireAuth = authenticate(accessTokenVerifier, currentUserRepository);

  router.get(
    '/shared-scans',
    requireAuth,
    validateRequest({ query: ListSharedScansQuerySchema }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { query } = response.locals.validated as { query: ListSharedScansQuery };
        const result = await sharedScansService.list(userId, {
          page: query.page,
          limit: query.limit,
          sort: query.sort,
          ...(query.search === undefined ? {} : { search: query.search }),
        });
        const responseBody = SharedScanListResponseSchema.parse(result);

        response.status(200).json(responseBody);
      } catch (error) {
        next(mapError(error) ?? error);
      }
    },
  );

  router.get(
    '/shared-scans/:scanId',
    requireAuth,
    validateRequest({ params: SharedScanIdParamSchema }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { params } = response.locals.validated as { params: { scanId: string } };
        const result = await sharedScansService.detail(userId, params.scanId);
        const responseBody = SharedScanResponseSchema.parse(result);

        response.status(200).json(responseBody);
      } catch (error) {
        next(mapError(error) ?? error);
      }
    },
  );

  router.delete(
    '/shared-scans/:scanId',
    requireAuth,
    validateRequest({ params: SharedScanIdParamSchema }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { params } = response.locals.validated as { params: { scanId: string } };
        const result = await sharedScansService.remove(userId, params.scanId);
        const responseBody = SharedScanRemoveResponseSchema.parse(result);

        response.status(200).json(responseBody);
      } catch (error) {
        next(mapError(error) ?? error);
      }
    },
  );

  return router;
}
