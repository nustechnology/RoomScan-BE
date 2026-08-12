import { Router } from 'express';

import { AppError } from '../../common/errors/app-error.js';
import { authenticate, getUserId } from '../../common/middleware/authenticate.js';
import type {
  AccessTokenVerifier,
  CurrentUserRepository,
} from '../../common/middleware/authenticate.js';
import { validateRequest } from '../../common/middleware/validate-request.js';
import { ProjectNotFoundError } from '../project/project.errors.js';
import { NotSharedProjectError, SharedProjectNotInListError } from './shared-projects.errors.js';
import {
  ListSharedProjectsQuerySchema,
  SharedProjectIdParamSchema,
  SharedProjectListResponseSchema,
  SharedProjectRemoveResponseSchema,
  SharedProjectResponseSchema,
  type ListSharedProjectsQuery,
} from './shared-projects.schemas.js';
import type { SharedProjectsService } from './shared-projects.service.js';

export interface SharedProjectsRouterDependencies {
  sharedProjectsService: SharedProjectsService;
  accessTokenVerifier: AccessTokenVerifier;
  currentUserRepository: CurrentUserRepository;
}

function mapError(error: unknown): AppError | undefined {
  if (error instanceof ProjectNotFoundError) {
    return new AppError({
      statusCode: 404,
      code: 'PROJECT_NOT_FOUND',
      message: 'Project was not found',
    });
  }
  if (error instanceof NotSharedProjectError) {
    return new AppError({
      statusCode: 403,
      code: 'NOT_SHARED_PROJECT',
      message: 'This project is not shared with you',
    });
  }
  if (error instanceof SharedProjectNotInListError) {
    return new AppError({
      statusCode: 409,
      code: 'NOT_IN_SHARED_WITH_ME',
      message: 'This project is not in your Shared With Me list',
    });
  }
  return undefined;
}

export function createSharedProjectsRouter({
  sharedProjectsService,
  accessTokenVerifier,
  currentUserRepository,
}: SharedProjectsRouterDependencies): Router {
  const router = Router();
  const requireAuth = authenticate(accessTokenVerifier, currentUserRepository);

  router.get(
    '/shared-projects',
    requireAuth,
    validateRequest({ query: ListSharedProjectsQuerySchema }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { query } = response.locals.validated as { query: ListSharedProjectsQuery };
        const result = await sharedProjectsService.list(userId, {
          page: query.page,
          limit: query.limit,
          sort: query.sort,
          ...(query.search === undefined ? {} : { search: query.search }),
        });
        const responseBody = SharedProjectListResponseSchema.parse(result);

        response.status(200).json(responseBody);
      } catch (error) {
        next(mapError(error) ?? error);
      }
    },
  );

  router.get(
    '/shared-projects/:projectId',
    requireAuth,
    validateRequest({ params: SharedProjectIdParamSchema }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { params } = response.locals.validated as { params: { projectId: string } };
        const result = await sharedProjectsService.detail(userId, params.projectId);
        const responseBody = SharedProjectResponseSchema.parse(result);

        response.status(200).json(responseBody);
      } catch (error) {
        next(mapError(error) ?? error);
      }
    },
  );

  router.delete(
    '/shared-projects/:projectId',
    requireAuth,
    validateRequest({ params: SharedProjectIdParamSchema }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { params } = response.locals.validated as { params: { projectId: string } };
        const result = await sharedProjectsService.remove(userId, params.projectId);
        const responseBody = SharedProjectRemoveResponseSchema.parse(result);

        response.status(200).json(responseBody);
      } catch (error) {
        next(mapError(error) ?? error);
      }
    },
  );

  return router;
}
