import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

import { ErrorResponseSchema } from '../../common/schemas/error.js';
import { IdempotencyKeyHeaderSchema } from '../../common/schemas/request-headers.js';
import { ScanIdParamSchema } from '../scan/scan.schemas.js';
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
} from './scan-asset.schemas.js';

export const scanAssetOpenApiRegistry = new OpenAPIRegistry();

const bearerAuth = 'BearerAuth';

const createUploadSessionBody = scanAssetOpenApiRegistry.register(
  'CreateUploadSessionBody',
  CreateUploadSessionBodySchema,
);
const completeUploadBody = scanAssetOpenApiRegistry.register(
  'CompleteUploadBody',
  CompleteUploadBodySchema,
);
const failUploadBody = scanAssetOpenApiRegistry.register('FailUploadBody', FailUploadBodySchema);
const createUploadSessionResponse = scanAssetOpenApiRegistry.register(
  'CreateUploadSessionResponse',
  CreateUploadSessionResponseSchema,
);
const assetMetadataResponse = scanAssetOpenApiRegistry.register(
  'AssetMetadataResponse',
  AssetMetadataResponseSchema,
);
const listAssetsResponse = scanAssetOpenApiRegistry.register(
  'ListAssetsResponse',
  ListAssetsResponseSchema,
);
const downloadUrlResponse = scanAssetOpenApiRegistry.register(
  'DownloadUrlResponse',
  DownloadUrlResponseSchema,
);
const errorResponse = scanAssetOpenApiRegistry.register(
  'ScanAssetErrorResponse',
  ErrorResponseSchema,
);

const rateLimitHeaders = {
  RateLimit: {
    description: 'Current quota state for the applicable rate-limit policies',
    schema: {
      type: 'string' as const,
    },
  },
  'RateLimit-Policy': {
    description: 'Rate-limit policies applied to this request',
    schema: {
      type: 'string' as const,
    },
  },
};

const commonErrorResponses = {
  400: {
    description: 'The request body, path parameters, or query parameters are invalid',
    headers: rateLimitHeaders,
    content: {
      'application/json': {
        schema: errorResponse,
      },
    },
  },
  401: {
    description: 'The access token is missing or invalid, or its subject user no longer exists',
    headers: rateLimitHeaders,
    content: {
      'application/json': {
        schema: errorResponse,
      },
    },
  },
  429: {
    description: 'The client exceeded an API rate limit',
    headers: {
      ...rateLimitHeaders,
      'Retry-After': {
        description: 'Seconds until the client may retry',
        schema: {
          type: 'integer' as const,
          minimum: 0,
        },
      },
    },
    content: {
      'application/json': {
        schema: errorResponse,
      },
    },
  },
  500: {
    description: 'An internal server error occurred',
    headers: rateLimitHeaders,
    content: {
      'application/json': {
        schema: errorResponse,
      },
    },
  },
};

const scanNotFoundResponse = {
  description: 'The scan is missing, deleted, or inaccessible through its parent project',
  headers: rateLimitHeaders,
  content: {
    'application/json': {
      schema: errorResponse,
    },
  },
};

const assetNotFoundResponse = {
  description: 'The asset is missing or inaccessible',
  headers: rateLimitHeaders,
  content: {
    'application/json': {
      schema: errorResponse,
    },
  },
};

const downloadNotFoundResponse = {
  description:
    'The scan is missing, deleted, or inaccessible through its parent project, or the asset record is missing or inaccessible',
  headers: rateLimitHeaders,
  content: {
    'application/json': {
      schema: errorResponse,
    },
  },
};

const assetNotReadyResponse = {
  description: 'The asset has not been uploaded yet',
  headers: rateLimitHeaders,
  content: {
    'application/json': {
      schema: errorResponse,
    },
  },
};

const uploadSessionConflictResponse = {
  description: 'The upload session is expired or the upload could not be verified',
  headers: rateLimitHeaders,
  content: {
    'application/json': {
      schema: errorResponse,
    },
  },
};

const storageUnavailableResponse = {
  description: 'The storage provider is unavailable',
  headers: rateLimitHeaders,
  content: {
    'application/json': {
      schema: errorResponse,
    },
  },
};

const idempotencyConflictResponse = {
  description: 'The Idempotency-Key was already used with a different request body',
  headers: rateLimitHeaders,
  content: {
    'application/json': {
      schema: errorResponse,
    },
  },
};

const downloadUrlParams = ScanIdParamSchema.merge(AssetTypeParamSchema);

scanAssetOpenApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/scans/{scanId}/assets/upload-sessions',
  tags: ['Scan Assets'],
  summary: 'Create an upload session for a model or thumbnail asset',
  security: [{ [bearerAuth]: [] }],
  request: {
    params: ScanIdParamSchema,
    body: {
      required: true,
      content: {
        'application/json': {
          schema: createUploadSessionBody,
        },
      },
    },
    headers: IdempotencyKeyHeaderSchema,
  },
  responses: {
    201: {
      description: 'The upload session was created',
      headers: rateLimitHeaders,
      content: {
        'application/json': {
          schema: createUploadSessionResponse,
        },
      },
    },
    200: {
      description: 'An active upload session already exists',
      headers: rateLimitHeaders,
      content: {
        'application/json': {
          schema: createUploadSessionResponse,
        },
      },
    },
    ...commonErrorResponses,
    404: scanNotFoundResponse,
    409: idempotencyConflictResponse,
  },
});

scanAssetOpenApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/upload-sessions/{uploadSessionId}/complete',
  tags: ['Scan Assets'],
  summary: 'Mark an upload session as completed',
  security: [{ [bearerAuth]: [] }],
  request: {
    params: UploadSessionIdParamSchema,
    body: {
      required: true,
      content: {
        'application/json': {
          schema: completeUploadBody,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'The upload was marked as completed',
      headers: rateLimitHeaders,
      content: {
        'application/json': {
          schema: assetMetadataResponse,
        },
      },
    },
    ...commonErrorResponses,
    404: assetNotFoundResponse,
    409: uploadSessionConflictResponse,
    503: storageUnavailableResponse,
  },
});

scanAssetOpenApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/scans/{scanId}/assets',
  tags: ['Scan Assets'],
  summary: 'List asset metadata for a scan',
  security: [{ [bearerAuth]: [] }],
  request: {
    params: ScanIdParamSchema,
  },
  responses: {
    200: {
      description: 'A list of asset metadata',
      headers: rateLimitHeaders,
      content: {
        'application/json': {
          schema: listAssetsResponse,
        },
      },
    },
    ...commonErrorResponses,
    404: scanNotFoundResponse,
  },
});

scanAssetOpenApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/scans/{scanId}/assets/{assetType}/download-url',
  tags: ['Scan Assets'],
  summary: 'Generate a download URL for a model or thumbnail asset',
  security: [{ [bearerAuth]: [] }],
  request: {
    params: downloadUrlParams,
  },
  responses: {
    200: {
      description: 'A download URL carrying the configured TTL expiry',
      headers: rateLimitHeaders,
      content: {
        'application/json': {
          schema: downloadUrlResponse,
        },
      },
    },
    ...commonErrorResponses,
    404: downloadNotFoundResponse,
    409: assetNotReadyResponse,
  },
});

scanAssetOpenApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/upload-sessions/{uploadSessionId}/fail',
  tags: ['Scan Assets'],
  summary: 'Report an upload failure for an upload session',
  security: [{ [bearerAuth]: [] }],
  request: {
    params: UploadSessionIdParamSchema,
    body: {
      required: true,
      content: {
        'application/json': {
          schema: failUploadBody,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'The upload was marked as failed',
      headers: rateLimitHeaders,
      content: {
        'application/json': {
          schema: assetMetadataResponse,
        },
      },
    },
    ...commonErrorResponses,
    404: assetNotFoundResponse,
  },
});
