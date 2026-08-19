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
import { ProjectIdParamSchema, type ProjectIdParam } from '../project/project.schemas.js';
import { ProjectNotFoundError } from '../project/project.errors.js';
import {
  InvalidAssetRequestError,
  StorageUnavailableError,
} from '../scan-asset/scan-asset.errors.js';

import { ScanNotFoundError } from './scan.errors.js';
import {
  CreateScanBodySchema,
  CreateScanResponseSchema,
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
  const commonError = idempotencyErrorToAppError(error) ?? revisionErrorToAppError(error);
  if (commonError !== undefined) return commonError;
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
  if (error instanceof InvalidAssetRequestError) {
    return new AppError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Asset metadata is invalid',
    });
  }
  if (error instanceof StorageUnavailableError) {
    return new AppError({
      statusCode: 503,
      code: 'STORAGE_UNAVAILABLE',
      message: 'Storage provider is unavailable',
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
    validateRequest({
      body: CreateScanBodySchema,
      params: ProjectIdParamSchema,
      headers: IdempotencyKeyHeaderSchema,
    }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { body, params, headers } = response.locals.validated as {
          body: CreateScanBody;
          params: ProjectIdParam;
          headers: { 'Idempotency-Key': string };
        };
        const data: ScanCreateInput = {
          name: body.name,
          description: body.description,
          ...(body.clientMutationId === undefined
            ? {}
            : { clientMutationId: body.clientMutationId }),
        };
        const key = resolveIdempotencyKey(headers['Idempotency-Key'], body.clientMutationId);
        const canonicalBody = {
          name: body.name,
          description: body.description,
          ...(body.thumbnail === undefined ? {} : { thumbnail: body.thumbnail }),
          ...(body.scanFile === undefined ? {} : { scanFile: body.scanFile }),
        };
        const uploadDescriptors = [
          ...(body.thumbnail === undefined
            ? []
            : [
                {
                  assetType: 'THUMBNAIL' as const,
                  contentType: body.thumbnail.contentType,
                  sizeBytes: body.thumbnail.sizeBytes,
                  ...(body.thumbnail.checksum === undefined
                    ? {}
                    : { checksum: body.thumbnail.checksum }),
                },
              ]),
          ...(body.scanFile === undefined
            ? []
            : [
                {
                  assetType: 'MODEL' as const,
                  contentType: body.scanFile.contentType,
                  sizeBytes: body.scanFile.sizeBytes,
                  checksum: body.scanFile.checksum,
                  modelVersion: body.scanFile.modelVersion,
                },
              ]),
        ];
        const result = await scanService.createWithUploadsIdempotently(
          userId,
          params.projectId,
          data,
          uploadDescriptors,
          key,
          canonicalBody,
        );
        const responseBody = CreateScanResponseSchema.parse(result.body);
        setRevisionEtag(response, responseBody.revision);
        response.status(result.statusCode).json(responseBody);
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

        setRevisionEtag(response, responseBody.revision);
        response.status(200).json(responseBody);
      } catch (error) {
        next(notFoundToAppError(error) ?? error);
      }
    },
  );

  router.patch(
    '/scans/:scanId',
    requireAuth,
    validateRequest({
      body: UpdateScanBodySchema,
      params: ScanIdParamSchema,
      headers: IfMatchHeaderSchema,
    }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { body, params, headers } = response.locals.validated as {
          body: UpdateScanBody;
          params: ScanIdParam;
          headers: { 'If-Match': string };
        };
        const data: ScanUpdateInput = {};
        const expectedRevision = parseIfMatch(headers['If-Match']);
        if (body.name !== undefined) {
          data.name = body.name;
        }
        if (body.description !== undefined) {
          data.description = body.description;
        }
        const result = await scanService.update(userId, params.scanId, expectedRevision, data);
        const responseBody = ScanResponseSchema.parse(result);

        setRevisionEtag(response, responseBody.revision);
        response.status(200).json(responseBody);
      } catch (error) {
        next(notFoundToAppError(error) ?? error);
      }
    },
  );

  router.delete(
    '/scans/:scanId',
    requireAuth,
    validateRequest({ params: ScanIdParamSchema, headers: IfMatchHeaderSchema }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { params, headers } = response.locals.validated as {
          params: ScanIdParam;
          headers: { 'If-Match': string };
        };
        const expectedRevision = parseIfMatch(headers['If-Match']);
        const revision = await scanService.delete(userId, params.scanId, expectedRevision);

        setRevisionEtag(response, revision);
        response.status(204).end();
      } catch (error) {
        next(notFoundToAppError(error) ?? error);
      }
    },
  );

  return router;
}
