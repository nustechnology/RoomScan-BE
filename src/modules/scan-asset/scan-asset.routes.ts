import { Router } from 'express';

import { AppError } from '../../common/errors/app-error.js';
import { authenticate, getUserId } from '../../common/middleware/authenticate.js';
import type {
  AccessTokenVerifier,
  CurrentUserRepository,
} from '../../common/middleware/authenticate.js';
import { validateRequest } from '../../common/middleware/validate-request.js';
import { ScanIdParamSchema, type ScanIdParam } from '../scan/scan.schemas.js';
import { ScanNotFoundError } from '../scan/scan.errors.js';
import { ProjectNotFoundError } from '../project/project.errors.js';
import {
  AssetNotReadyError,
  AssetUploadFailedError,
  InvalidAssetRequestError,
  ScanAssetNotFoundError,
  StorageUnavailableError,
  UploadSessionExpiredError,
} from './scan-asset.errors.js';
import {
  AssetMetadataResponseSchema,
  AssetTypeParamSchema,
  CompleteUploadBodySchema,
  CreateUploadSessionBodySchema,
  CreateUploadSessionResponseSchema,
  DownloadUrlResponseSchema,
  FailUploadBodySchema,
  ListAssetsResponseSchema,
  UploadSessionIdParamSchema,
  type AssetTypeParam,
  type CompleteUploadBody,
  type CreateUploadSessionBody,
  type FailUploadBody,
  type UploadSessionIdParam,
} from './scan-asset.schemas.js';
import type { ScanAssetService } from './scan-asset.service.js';

export interface ScanAssetRouterDependencies {
  scanAssetService: ScanAssetService;
  accessTokenVerifier: AccessTokenVerifier;
  currentUserRepository: CurrentUserRepository;
}

function mapError(error: unknown): AppError | undefined {
  if (error instanceof ScanNotFoundError) {
    return new AppError({ statusCode: 404, code: 'SCAN_NOT_FOUND', message: 'Scan was not found' });
  }
  if (error instanceof ProjectNotFoundError) {
    return new AppError({
      statusCode: 404,
      code: 'PROJECT_NOT_FOUND',
      message: 'Project was not found',
    });
  }
  if (error instanceof ScanAssetNotFoundError) {
    return new AppError({
      statusCode: 404,
      code: 'ASSET_NOT_FOUND',
      message: 'Asset was not found',
    });
  }
  if (error instanceof InvalidAssetRequestError) {
    return new AppError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Asset metadata is invalid',
    });
  }
  if (error instanceof AssetNotReadyError) {
    return new AppError({
      statusCode: 409,
      code: 'ASSET_NOT_READY',
      message: 'Asset has not been uploaded yet',
    });
  }
  if (error instanceof UploadSessionExpiredError) {
    return new AppError({
      statusCode: 409,
      code: 'UPLOAD_SESSION_EXPIRED',
      message: 'Upload session has expired',
    });
  }
  if (error instanceof AssetUploadFailedError) {
    return new AppError({
      statusCode: 409,
      code: 'ASSET_UPLOAD_FAILED',
      message: 'Asset upload could not be verified',
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

export function createScanAssetRouter({
  scanAssetService,
  accessTokenVerifier,
  currentUserRepository,
}: ScanAssetRouterDependencies): Router {
  const router = Router();
  const requireAuth = authenticate(accessTokenVerifier, currentUserRepository);

  router.post(
    '/scans/:scanId/assets/upload-sessions',
    requireAuth,
    validateRequest({ body: CreateUploadSessionBodySchema, params: ScanIdParamSchema }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { body, params } = response.locals.validated as {
          body: CreateUploadSessionBody;
          params: ScanIdParam;
        };
        const data = {
          assetType: body.assetType,
          contentType: body.contentType,
          sizeBytes: body.sizeBytes,
          ...(body.checksum === undefined ? {} : { checksum: body.checksum }),
          ...(body.modelVersion === undefined ? {} : { modelVersion: body.modelVersion }),
          ...(body.idempotencyKey === undefined ? {} : { idempotencyKey: body.idempotencyKey }),
        };
        const result = await scanAssetService.createUploadSession(userId, params.scanId, data);
        const responseBody = CreateUploadSessionResponseSchema.parse(result);
        response.status(result.created ? 201 : 200).json(responseBody);
      } catch (error) {
        next(mapError(error) ?? error);
      }
    },
  );

  router.post(
    '/upload-sessions/:uploadSessionId/complete',
    requireAuth,
    validateRequest({ body: CompleteUploadBodySchema, params: UploadSessionIdParamSchema }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { body, params } = response.locals.validated as {
          body: CompleteUploadBody;
          params: UploadSessionIdParam;
        };
        const data = {
          ...(body.checksum === undefined ? {} : { checksum: body.checksum }),
          ...(body.sizeBytes === undefined ? {} : { sizeBytes: body.sizeBytes }),
        };
        const result = await scanAssetService.completeUpload(userId, params.uploadSessionId, data);
        const responseBody = AssetMetadataResponseSchema.parse(result);
        response.status(200).json(responseBody);
      } catch (error) {
        next(mapError(error) ?? error);
      }
    },
  );

  router.get(
    '/scans/:scanId/assets',
    requireAuth,
    validateRequest({ params: ScanIdParamSchema }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { params } = response.locals.validated as { params: ScanIdParam };
        const result = await scanAssetService.listAssets(userId, params.scanId);
        const responseBody = ListAssetsResponseSchema.parse(result);
        response.status(200).json(responseBody);
      } catch (error) {
        next(mapError(error) ?? error);
      }
    },
  );

  router.get(
    '/scans/:scanId/assets/:assetType/download-url',
    requireAuth,
    validateRequest({ params: ScanIdParamSchema.merge(AssetTypeParamSchema) }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { params } = response.locals.validated as {
          params: ScanIdParam & AssetTypeParam;
        };
        const result = await scanAssetService.getDownloadUrl(
          userId,
          params.scanId,
          params.assetType,
        );
        const responseBody = DownloadUrlResponseSchema.parse(result);
        response.status(200).json(responseBody);
      } catch (error) {
        next(mapError(error) ?? error);
      }
    },
  );

  router.post(
    '/upload-sessions/:uploadSessionId/fail',
    requireAuth,
    validateRequest({ body: FailUploadBodySchema, params: UploadSessionIdParamSchema }),
    async (request, response, next) => {
      try {
        const userId = getUserId(request);
        const { body, params } = response.locals.validated as {
          body: FailUploadBody;
          params: UploadSessionIdParam;
        };
        const data = {
          ...(body.reason === undefined ? {} : { reason: body.reason }),
        };
        const result = await scanAssetService.failUpload(userId, params.uploadSessionId, data);
        const responseBody = AssetMetadataResponseSchema.parse(result);
        response.status(200).json(responseBody);
      } catch (error) {
        next(mapError(error) ?? error);
      }
    },
  );

  return router;
}
