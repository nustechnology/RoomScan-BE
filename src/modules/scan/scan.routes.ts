import { Router } from 'express';

import { AppError } from '../../common/errors/app-error.js';
import { authenticate, getUserId } from '../../common/middleware/authenticate.js';
import type {
  AccessTokenVerifier,
  CurrentUserRepository,
} from '../../common/middleware/authenticate.js';
import { validateRequest } from '../../common/middleware/validate-request.js';
import { ProjectIdParamSchema, type ProjectIdParam } from '../project/project.schemas.js';
import { ProjectNotFoundError } from '../project/project.errors.js';
import { ScanNotFoundError } from './scan.errors.js';
import {
  CreateScanBodySchema,
  ListScansQuerySchema,
  ScanIdParamSchema,
  ScanListResponseSchema,
  ScanResponseSchema,
  UpdateScanBodySchema,
  type CreateScanBody,
  type ListScansQuery,
  type ScanIdParam,
  type UpdateScanBody,
} from './scan.schemas.js';
import type { ScanService } from './scan.service.js';
import type { ScanCreateInput, ScanUpdateInput } from './scan.types.js';

export interface ScanRouterDependencies {
  scanService: ScanService;
  accessTokenVerifier: AccessTokenVerifier;
  currentUserRepository: CurrentUserRepository;
}

function notFoundToAppError(error: unknown): AppError | undefined {
  if (error instanceof ScanNotFoundError) {
    return new AppError({
      statusCode: 404,
      code: 'SCAN_NOT_FOUND',
      message: 'Scan was not found',
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

export function createScanRouter({
  scanService,
  accessTokenVerifier,
  currentUserRepository,
}: ScanRouterDependencies): Router {
  const router = Router();
  const requireAuth = authenticate(accessTokenVerifier, currentUserRepository);

  router.post(
    '/projects/:projectId/scans',
    requireAuth,
    validateRequest({ body: CreateScanBodySchema, params: ProjectIdParamSchema }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { body, params } = response.locals.validated as {
          body: CreateScanBody;
          params: ProjectIdParam;
        };
        const data: ScanCreateInput = {
          name: body.name,
          description: body.description,
          ...(body.clientMutationId === undefined
            ? {}
            : { clientMutationId: body.clientMutationId }),
        };
        const { scan, created } = await scanService.create(userId, params.projectId, data);
        const responseBody = ScanResponseSchema.parse(scan);

        response.status(created ? 201 : 200).json(responseBody);
      } catch (error) {
        next(notFoundToAppError(error) ?? error);
      }
    },
  );

  router.get(
    '/projects/:projectId/scans',
    requireAuth,
    validateRequest({ params: ProjectIdParamSchema, query: ListScansQuerySchema }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { params, query } = response.locals.validated as {
          params: ProjectIdParam;
          query: ListScansQuery;
        };
        const result = await scanService.list(userId, params.projectId, {
          page: query.page,
          limit: query.limit,
          sort: query.sort,
        });
        const responseBody = ScanListResponseSchema.parse(result);

        response.status(200).json(responseBody);
      } catch (error) {
        next(notFoundToAppError(error) ?? error);
      }
    },
  );

  router.get(
    '/scans/:scanId',
    requireAuth,
    validateRequest({ params: ScanIdParamSchema }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { params } = response.locals.validated as { params: ScanIdParam };
        const result = await scanService.getById(userId, params.scanId);
        const responseBody = ScanResponseSchema.parse(result);

        response.status(200).json(responseBody);
      } catch (error) {
        next(notFoundToAppError(error) ?? error);
      }
    },
  );

  router.patch(
    '/scans/:scanId',
    requireAuth,
    validateRequest({ body: UpdateScanBodySchema, params: ScanIdParamSchema }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { body, params } = response.locals.validated as {
          body: UpdateScanBody;
          params: ScanIdParam;
        };
        const data: ScanUpdateInput = {};
        if (body.name !== undefined) {
          data.name = body.name;
        }
        if (body.description !== undefined) {
          data.description = body.description;
        }
        const result = await scanService.update(userId, params.scanId, data);
        const responseBody = ScanResponseSchema.parse(result);

        response.status(200).json(responseBody);
      } catch (error) {
        next(notFoundToAppError(error) ?? error);
      }
    },
  );

  router.delete(
    '/scans/:scanId',
    requireAuth,
    validateRequest({ params: ScanIdParamSchema }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { params } = response.locals.validated as { params: ScanIdParam };
        await scanService.delete(userId, params.scanId);

        response.status(204).end();
      } catch (error) {
        next(notFoundToAppError(error) ?? error);
      }
    },
  );

  return router;
}
