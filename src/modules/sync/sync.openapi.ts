import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

import { ErrorResponseSchema } from '../../common/schemas/error.js';
import {
  SyncChangesQuerySchema,
  SyncChangesResponseSchema,
  SyncStatusQuerySchema,
  SyncStatusResponseSchema,
} from './sync.schemas.js';

export const syncOpenApiRegistry = new OpenAPIRegistry();

const bearerAuth = syncOpenApiRegistry.registerComponent('securitySchemes', 'BearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
});
const changesResponse = syncOpenApiRegistry.register(
  'SyncChangesResponse',
  SyncChangesResponseSchema,
);
const statusResponse = syncOpenApiRegistry.register('SyncStatusResponse', SyncStatusResponseSchema);
const errorResponse = syncOpenApiRegistry.register('SyncErrorResponse', ErrorResponseSchema);

const errorContent = {
  'application/json': { schema: errorResponse },
};

syncOpenApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/sync/changes',
  tags: ['Sync'],
  summary: 'Pull visible resource changes',
  description:
    'Returns an initial normalized snapshot when no cursor or timestamp is supplied, then uses an opaque user-bound cursor for incremental changes.',
  security: [{ [bearerAuth.name]: [] }],
  request: { query: SyncChangesQuerySchema },
  responses: {
    200: {
      description: 'Visible resource changes and the next opaque cursor',
      content: { 'application/json': { schema: changesResponse } },
    },
    400: {
      description: 'The cursor, timestamp, limit, or query combination is invalid',
      content: errorContent,
    },
    401: { description: 'The access token is missing or invalid', content: errorContent },
    429: { description: 'The API rate limit was exceeded', content: errorContent },
    500: { description: 'An unexpected server failure occurred', content: errorContent },
  },
});

syncOpenApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/sync/status',
  tags: ['Sync'],
  summary: 'Get project sync readiness',
  description:
    'Returns backend-known sync readiness for every accessible project, or one project when projectId is supplied.',
  security: [{ [bearerAuth.name]: [] }],
  request: { query: SyncStatusQuerySchema },
  responses: {
    200: {
      description: 'Project sync status summaries',
      content: { 'application/json': { schema: statusResponse } },
    },
    400: { description: 'The projectId query parameter is invalid', content: errorContent },
    401: { description: 'The access token is missing or invalid', content: errorContent },
    404: { description: 'The requested project is not accessible', content: errorContent },
    429: { description: 'The API rate limit was exceeded', content: errorContent },
    500: { description: 'An unexpected server failure occurred', content: errorContent },
  },
});
