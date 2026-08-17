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
  scanAssetService,
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
        const key = resolveIdempotencyKey(
          typeof request.headers['idempotency-key'] === 'string'
            ? request.headers['idempotency-key']
            : undefined,
          body.clientMutationId,
        );
        const canonicalBody = {
          name: body.name,
          description: body.description,
          ...(body.thumbnail === undefined ? {} : { thumbnail: body.thumbnail }),
          ...(body.scanFile === undefined ? {} : { scanFile: body.scanFile }),
        };
        if (typeof scanService.createWithUploadsIdempotently === 'function') {
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
          return;
        }
        const idempotent =
          typeof scanService.createIdempotently === 'function'
            ? await scanService.createIdempotently(
                userId,
                params.projectId,
                data,
                key,
                canonicalBody,
              )
            : await scanService
                .create(userId, params.projectId, data)
                .then(({ scan, created }) => ({
                  body: scan,
                  statusCode: created ? 201 : 200,
                  replayed: !created,
                }));
        const scan = idempotent.body;

        const uploads: { thumbnail?: ScanUploadUrl; scanFile?: ScanUploadUrl } = {};
        if (body.thumbnail !== undefined) {
          const uploadInput = {
            assetType: 'THUMBNAIL',
            contentType: body.thumbnail.contentType,
            sizeBytes: body.thumbnail.sizeBytes,
            ...(body.thumbnail.checksum === undefined ? {} : { checksum: body.thumbnail.checksum }),
          } as const;
          const result =
            typeof scanAssetService.createUploadSessionIdempotently === 'function'
              ? await scanAssetService.createUploadSessionIdempotently(
                  userId,
                  scan.id,
                  uploadInput,
                  `${key.slice(0, 110)}:thumbnail`,
                )
              : { body: await scanAssetService.createUploadSession(userId, scan.id, uploadInput) };
          uploads.thumbnail = ScanUploadUrlSchema.parse({
            uploadSessionId: result.body.uploadSessionId,
            assetId: result.body.assetId,
            uploadUrl: result.body.uploadUrl,
            uploadUrlExpiresAt: result.body.uploadUrlExpiresAt,
          });
        }
        if (body.scanFile !== undefined) {
          const uploadInput = {
            assetType: 'MODEL',
            contentType: body.scanFile.contentType,
            sizeBytes: body.scanFile.sizeBytes,
            checksum: body.scanFile.checksum,
            modelVersion: body.scanFile.modelVersion,
          } as const;
          const result =
            typeof scanAssetService.createUploadSessionIdempotently === 'function'
              ? await scanAssetService.createUploadSessionIdempotently(
                  userId,
                  scan.id,
                  uploadInput,
                  `${key.slice(0, 114)}:model`,
                )
              : { body: await scanAssetService.createUploadSession(userId, scan.id, uploadInput) };
          uploads.scanFile = ScanUploadUrlSchema.parse({
            uploadSessionId: result.body.uploadSessionId,
            assetId: result.body.assetId,
            uploadUrl: result.body.uploadUrl,
            uploadUrlExpiresAt: result.body.uploadUrlExpiresAt,
          });
        }

        const hasUploads = body.thumbnail !== undefined || body.scanFile !== undefined;
        const responseBody = hasUploads
          ? CreateScanResponseSchema.parse({ ...scan, uploads })
          : ScanResponseSchema.parse(scan);

        setRevisionEtag(response, responseBody.revision);
        response.status(idempotent.statusCode).json(responseBody);
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
    validateRequest({ body: UpdateScanBodySchema, params: ScanIdParamSchema }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { body, params } = response.locals.validated as {
          body: UpdateScanBody;
          params: ScanIdParam;
        };
        const data: ScanUpdateInput = {};
        const expectedRevision = parseIfMatch(
          typeof request.headers['if-match'] === 'string' ? request.headers['if-match'] : undefined,
        );
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
    validateRequest({ params: ScanIdParamSchema }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { params } = response.locals.validated as { params: ScanIdParam };
        const expectedRevision = parseIfMatch(
          typeof request.headers['if-match'] === 'string' ? request.headers['if-match'] : undefined,
        );
        const revision = await scanService.delete(userId, params.scanId, expectedRevision);

        if (revision !== undefined) setRevisionEtag(response, revision);
        response.status(204).end();
      } catch (error) {
        next(notFoundToAppError(error) ?? error);
      }
    },
  );

  return router;
}
