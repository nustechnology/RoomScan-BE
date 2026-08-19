import { Router } from 'express';

import { AppError } from '../../common/errors/app-error.js';
import {
  idempotencyErrorToAppError,
  resolveIdempotencyKey,
} from '../../common/idempotency/idempotency.js';
import { authenticate, getUserId } from '../../common/middleware/authenticate.js';
import type {
  AccessTokenVerifier,
  CurrentUserRepository,
} from '../../common/middleware/authenticate.js';
import { validateRequest } from '../../common/middleware/validate-request.js';
import {
  IdempotencyKeyHeaderSchema,
  IfMatchHeaderSchema,
} from '../../common/schemas/sync-headers.js';
import {
  parseIfMatch,
  revisionErrorToAppError,
  setRevisionEtag,
} from '../../common/revision/revision.js';
import { ProjectNotFoundError } from './project.errors.js';
import {
  CreateProjectBodySchema,
  ListProjectsQuerySchema,
  ProjectIdParamSchema,
  ProjectListResponseSchema,
  ProjectResponseSchema,
  UpdateProjectBodySchema,
  type CreateProjectBody,
  type ListProjectsQuery,
  type ProjectIdParam,
  type UpdateProjectBody,
} from './project.schemas.js';
import type { ProjectService } from './project.service.js';
import type { ProjectUpdateInput } from './project.types.js';

export interface ProjectRouterDependencies {
  projectService: ProjectService;
  accessTokenVerifier: AccessTokenVerifier;
  currentUserRepository: CurrentUserRepository;
}

function projectNotFoundToAppError(error: unknown): AppError | undefined {
  const commonError = idempotencyErrorToAppError(error) ?? revisionErrorToAppError(error);
  if (commonError !== undefined) {
    return commonError;
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

export function createProjectRouter({
  projectService,
  accessTokenVerifier,
  currentUserRepository,
}: ProjectRouterDependencies): Router {
  const router = Router();
  const requireAuth = authenticate(accessTokenVerifier, currentUserRepository);

  router.post(
    '/projects',
    requireAuth,
    validateRequest({ body: CreateProjectBodySchema, headers: IdempotencyKeyHeaderSchema }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { body, headers } = response.locals.validated as {
          body: CreateProjectBody;
          headers: { 'Idempotency-Key': string };
        };
        const key = resolveIdempotencyKey(headers['Idempotency-Key']);
        const result =
          typeof projectService.createIdempotently === 'function'
            ? await projectService.createIdempotently(userId, body, key)
            : { body: await projectService.create(userId, body), statusCode: 201, replayed: false };
        const responseBody = ProjectResponseSchema.parse(result.body);

        setRevisionEtag(response, responseBody.revision);
        response.status(result.statusCode).json(responseBody);
      } catch (error) {
        next(projectNotFoundToAppError(error) ?? error);
      }
    },
  );

  router.get(
    '/projects',
    requireAuth,
    validateRequest({ query: ListProjectsQuerySchema }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { query } = response.locals.validated as { query: ListProjectsQuery };
        const result = await projectService.list(userId, {
          page: query.page,
          limit: query.limit,
          sort: query.sort,
          ...(query.search === undefined ? {} : { search: query.search }),
        });
        const responseBody = ProjectListResponseSchema.parse(result);

        response.status(200).json(responseBody);
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/projects/:projectId',
    requireAuth,
    validateRequest({ params: ProjectIdParamSchema }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { params } = response.locals.validated as { params: ProjectIdParam };
        const result = await projectService.getById(userId, params.projectId);
        const responseBody = ProjectResponseSchema.parse(result);

        setRevisionEtag(response, responseBody.revision);
        response.status(200).json(responseBody);
      } catch (error) {
        next(projectNotFoundToAppError(error) ?? error);
      }
    },
  );

  router.patch(
    '/projects/:projectId',
    requireAuth,
    validateRequest({
      body: UpdateProjectBodySchema,
      params: ProjectIdParamSchema,
      headers: IfMatchHeaderSchema,
    }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { body, params, headers } = response.locals.validated as {
          body: UpdateProjectBody;
          params: ProjectIdParam;
          headers: { 'If-Match': string };
        };
        const data: ProjectUpdateInput = {};
        const expectedRevision = parseIfMatch(headers['If-Match']);
        if (body.name !== undefined) {
          data.name = body.name;
        }
        if (body.description !== undefined) {
          data.description = body.description;
        }
        const result = await projectService.update(
          userId,
          params.projectId,
          expectedRevision,
          data,
        );
        const responseBody = ProjectResponseSchema.parse(result);

        setRevisionEtag(response, responseBody.revision);
        response.status(200).json(responseBody);
      } catch (error) {
        next(projectNotFoundToAppError(error) ?? error);
      }
    },
  );

  router.delete(
    '/projects/:projectId',
    requireAuth,
    validateRequest({ params: ProjectIdParamSchema, headers: IfMatchHeaderSchema }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { params, headers } = response.locals.validated as {
          params: ProjectIdParam;
          headers: { 'If-Match': string };
        };
        const expectedRevision = parseIfMatch(headers['If-Match']);
        const revision = await projectService.delete(userId, params.projectId, expectedRevision);

        setRevisionEtag(response, revision);
        response.status(204).end();
      } catch (error) {
        next(projectNotFoundToAppError(error) ?? error);
      }
    },
  );

  return router;
}
