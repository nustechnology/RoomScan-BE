import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

import { ErrorResponseSchema } from '../../common/schemas/error.js';
import {
  SyncChangesQuerySchema,
  SyncChangesResponseSchema,
  SyncProjectStatusSchema,
  SyncStatusListResponseSchema,
  SyncStatusQuerySchema,
} from './sync.schemas.js';

export const syncOpenApiRegistry = new OpenAPIRegistry();

const bearerAuth = 'BearerAuth';

const syncChangesResponse = syncOpenApiRegistry.register(
  'SyncChangesResponse',
  SyncChangesResponseSchema,
);
const syncProjectStatus = syncOpenApiRegistry.register(
  'SyncProjectStatus',
  SyncProjectStatusSchema,
);
const syncStatusListResponse = syncOpenApiRegistry.register(
  'SyncStatusListResponse',
  SyncStatusListResponseSchema,
);
const syncStatusResponse = syncOpenApiRegistry.register(
  'SyncStatusResponse',
  syncProjectStatus.or(syncStatusListResponse),
);
const errorResponse = syncOpenApiRegistry.register('SyncErrorResponse', ErrorResponseSchema);

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
    description: 'The query parameters are invalid or the cursor is malformed',
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

syncOpenApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/sync/changes',
  tags: ['Sync'],
  summary: 'List resources changed since a timestamp or cursor',
  security: [{ [bearerAuth]: [] }],
  request: {
    query: SyncChangesQuerySchema,
  },
  responses: {
    200: {
      description: 'Changed resources visible to the current user and the next cursor',
      headers: rateLimitHeaders,
      content: {
        'application/json': {
          schema: syncChangesResponse,
        },
      },
    },
    ...commonErrorResponses,
  },
});

syncOpenApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/sync/status',
  tags: ['Sync'],
  summary: 'Get sync status for the current user or a single project',
  security: [{ [bearerAuth]: [] }],
  request: {
    query: SyncStatusQuerySchema,
  },
  responses: {
    200: {
      description:
        'Sync status for a single project, or a list of project statuses when projectId is omitted',
      headers: rateLimitHeaders,
      content: {
        'application/json': {
          schema: syncStatusResponse,
        },
      },
    },
    ...commonErrorResponses,
    404: {
      description: 'The project is missing, deleted, or inaccessible to the current user',
      headers: rateLimitHeaders,
      content: {
        'application/json': {
          schema: errorResponse,
        },
      },
    },
  },
});
