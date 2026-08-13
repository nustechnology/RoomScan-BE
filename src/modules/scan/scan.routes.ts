import { Router } from 'express';
import type { RequestHandler } from 'express';

import { AppError } from '../../common/errors/app-error.js';
import { RevisionConflictError } from '../../common/errors/revision-conflict.js';
import { parseIfMatch } from '../../common/http/if-match.js';
import { authenticate, getUserId } from '../../common/middleware/authenticate.js';
import type {
  AccessTokenVerifier,
  CurrentUserRepository,
} from '../../common/middleware/authenticate.js';
import { validateRequest } from '../../common/middleware/validate-request.js';
import { ProjectIdParamSchema, type ProjectIdParam } from '../project/project.schemas.js';
import { ProjectNotFoundError } from '../project/project.errors.js';
import type { ScanAssetService } from '../scan-asset/scan-asset.service.js';
import { ScanNotFoundError } from './scan.errors.js';
import {
  CreateScanBodySchema,
  CreateScanResponseSchema,
  ListScansQuerySchema,
  ScanIdParamSchema,
  ScanListResponseSchema,
  ScanResponseSchema,
  ScanUploadUrlSchema,
  UpdateScanBodySchema,
  type CreateScanBody,
  type ListScansQuery,
  type ScanIdParam,
  type ScanUploadUrl,
  type UpdateScanBody,
} from './scan.schemas.js';
import type { ScanService } from './scan.service.js';
import type { ScanCreateInput, ScanUpdateInput } from './scan.types.js';

export interface ScanRouterDependencies {
  scanService: ScanService;
  scanAssetService: ScanAssetService;
  accessTokenVerifier: AccessTokenVerifier;
  currentUserRepository: CurrentUserRepository;
  idempotency: RequestHandler;
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

function errorToAppError(error: unknown): AppError | undefined {
  if (error instanceof RevisionConflictError) {
    return new AppError({
      statusCode: 409,
      code: 'REVISION_CONFLICT',
      message: 'The resource has changed since the client last read it',
    });
  }
  return notFoundToAppError(error);
}

export function createScanRouter({
  scanService,
  scanAssetService,
  accessTokenVerifier,
  currentUserRepository,
  idempotency,
}: ScanRouterDependencies): Router {
  const router = Router();
  const requireAuth = authenticate(accessTokenVerifier, currentUserRepository);

  router.post(
    '/projects/:projectId/scans',
    requireAuth,
    validateRequest({ body: CreateScanBodySchema, params: ProjectIdParamSchema }),
    idempotency,
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

        const uploads: { thumbnail?: ScanUploadUrl; scanFile?: ScanUploadUrl } = {};
        if (body.thumbnail !== undefined) {
          const result = await scanAssetService.createUploadSession(userId, scan.id, {
            assetType: 'THUMBNAIL',
            contentType: body.thumbnail.contentType,
            sizeBytes: body.thumbnail.sizeBytes,
            ...(body.thumbnail.checksum === undefined ? {} : { checksum: body.thumbnail.checksum }),
          });
          uploads.thumbnail = ScanUploadUrlSchema.parse({
            uploadSessionId: result.uploadSessionId,
            assetId: result.assetId,
            uploadUrl: result.uploadUrl,
            uploadUrlExpiresAt: result.uploadUrlExpiresAt,
          });
        }
        if (body.scanFile !== undefined) {
          const result = await scanAssetService.createUploadSession(userId, scan.id, {
            assetType: 'MODEL',
            contentType: body.scanFile.contentType,
            sizeBytes: body.scanFile.sizeBytes,
            checksum: body.scanFile.checksum,
            modelVersion: body.scanFile.modelVersion,
          });
          uploads.scanFile = ScanUploadUrlSchema.parse({
            uploadSessionId: result.uploadSessionId,
            assetId: result.assetId,
            uploadUrl: result.uploadUrl,
            uploadUrlExpiresAt: result.uploadUrlExpiresAt,
          });
        }

        const hasUploads = body.thumbnail !== undefined || body.scanFile !== undefined;
        const responseBody = hasUploads
          ? CreateScanResponseSchema.parse({ ...scan, uploads })
          : ScanResponseSchema.parse(scan);

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
        const expectedRevision = parseIfMatch(request.headers['if-match']);
        const result =
          expectedRevision === undefined
            ? await scanService.update(userId, params.scanId, data)
            : await scanService.update(userId, params.scanId, data, expectedRevision);
        const responseBody = ScanResponseSchema.parse(result);

        response.status(200).json(responseBody);
      } catch (error) {
        next(errorToAppError(error) ?? error);
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
