import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

import { ErrorResponseSchema } from '../../common/schemas/error.js';
import {
  ListSharedScansQuerySchema,
  SharedScanIdParamSchema,
  SharedScanListResponseSchema,
  SharedScanRemoveResponseSchema,
  SharedScanResponseSchema,
} from './shared-scans.schemas.js';

export const sharedScansOpenApiRegistry = new OpenAPIRegistry();

const bearerAuth = sharedScansOpenApiRegistry.registerComponent('securitySchemes', 'BearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
});

const sharedScanResponse = sharedScansOpenApiRegistry.register(
  'SharedScanResponse',
  SharedScanResponseSchema,
);
const sharedScanListResponse = sharedScansOpenApiRegistry.register(
  'SharedScanListResponse',
  SharedScanListResponseSchema,
);
const sharedScanRemoveResponse = sharedScansOpenApiRegistry.register(
  'SharedScanRemoveResponse',
  SharedScanRemoveResponseSchema,
);
const errorResponse = sharedScansOpenApiRegistry.register(
  'SharedScansErrorResponse',
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
    description: 'The request query parameters or path parameters are invalid',
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
  403: {
    description: 'The caller owns the scan, so it can never be in their Shared With Me list',
    headers: rateLimitHeaders,
    content: {
      'application/json': {
        schema: errorResponse,
      },
    },
  },
  404: {
    description: 'The scan is not shared with the current user or is no longer accessible',
    headers: rateLimitHeaders,
    content: {
      'application/json': {
        schema: errorResponse,
      },
    },
  },
  409: {
    description: 'The scan is not in the current user’s Shared With Me list',
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

sharedScansOpenApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/shared-scans',
  tags: ['Shared With Me'],
  summary: 'List scans shared with the current user',
  description:
    'Lists every scan the current user accepted a scan-level invitation for, including revoked and deleted scans, each with its current status. Owned scans never appear.',
  security: [{ [bearerAuth.name]: [] }],
  request: {
    query: ListSharedScansQuerySchema,
  },
  responses: {
    200: {
      description: 'A paginated list of shared scans',
      headers: rateLimitHeaders,
      content: {
        'application/json': {
          schema: sharedScanListResponse,
        },
      },
    },
    ...commonErrorResponses,
  },
});

sharedScansOpenApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/shared-scans/{scanId}',
  tags: ['Shared With Me'],
  summary: 'Get a shared scan as an active Viewer',
  description:
    'Returns the shared scan read-only. Scans that were revoked, deleted, or never shared are hidden behind 404.',
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: SharedScanIdParamSchema,
  },
  responses: {
    200: {
      description: 'The shared scan with read-only permissions',
      headers: rateLimitHeaders,
      content: {
        'application/json': {
          schema: sharedScanResponse,
        },
      },
    },
    ...commonErrorResponses,
  },
});

sharedScansOpenApiRegistry.registerPath({
  method: 'delete',
  path: '/api/v1/shared-scans/{scanId}',
  tags: ['Shared With Me'],
  summary: 'Remove a scan from the current user’s Shared With Me list',
  description:
    'Viewer only. Removes the scan from the current user’s Shared With Me list by marking their own access as removed, regardless of its current status; it is idempotent on retry. The original scan, the Owner, and other Viewers are unaffected.',
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: SharedScanIdParamSchema,
  },
  responses: {
    200: {
      description: 'The scan was removed from the Shared With Me list',
      headers: rateLimitHeaders,
      content: {
        'application/json': {
          schema: sharedScanRemoveResponse,
        },
      },
    },
    ...commonErrorResponses,
  },
});
