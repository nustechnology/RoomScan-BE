import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

import { ErrorResponseSchema } from '../../common/schemas/error.js';
import {
  ListSharedProjectsQuerySchema,
  SharedProjectDetailResponseSchema,
  SharedProjectIdParamSchema,
  SharedProjectListResponseSchema,
  SharedProjectRemoveResponseSchema,
} from './shared-projects.schemas.js';

export const sharedProjectsOpenApiRegistry = new OpenAPIRegistry();

const bearerAuth = sharedProjectsOpenApiRegistry.registerComponent(
  'securitySchemes',
  'BearerAuth',
  {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
  },
);

const sharedProjectDetailResponse = sharedProjectsOpenApiRegistry.register(
  'SharedProjectDetailResponse',
  SharedProjectDetailResponseSchema,
);
const sharedProjectListResponse = sharedProjectsOpenApiRegistry.register(
  'SharedProjectListResponse',
  SharedProjectListResponseSchema,
);
const sharedProjectRemoveResponse = sharedProjectsOpenApiRegistry.register(
  'SharedProjectRemoveResponse',
  SharedProjectRemoveResponseSchema,
);
const errorResponse = sharedProjectsOpenApiRegistry.register(
  'SharedProjectsErrorResponse',
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
    description: 'The caller owns the project, so it can never be in their Shared With Me list',
    headers: rateLimitHeaders,
    content: {
      'application/json': {
        schema: errorResponse,
      },
    },
  },
  404: {
    description: 'The project is not shared with the current user or is no longer accessible',
    headers: rateLimitHeaders,
    content: {
      'application/json': {
        schema: errorResponse,
      },
    },
  },
  409: {
    description: 'The project is not in the current user’s Shared With Me list',
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

sharedProjectsOpenApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/shared-projects',
  tags: ['Shared With Me'],
  summary: 'List projects shared with the current user',
  description:
    'Lists every project the current user accepted an invitation for, including revoked and deleted projects, each with its current status. Owned projects never appear.',
  security: [{ [bearerAuth.name]: [] }],
  request: {
    query: ListSharedProjectsQuerySchema,
  },
  responses: {
    200: {
      description: 'A paginated list of shared projects',
      headers: rateLimitHeaders,
      content: {
        'application/json': {
          schema: sharedProjectListResponse,
        },
      },
    },
    ...commonErrorResponses,
  },
});

sharedProjectsOpenApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/shared-projects/{projectId}',
  tags: ['Shared With Me'],
  summary: 'Get a shared project as an active Viewer',
  description:
    'Returns the shared project read-only. Projects that were revoked, deleted, or never shared are hidden behind 404.',
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: SharedProjectIdParamSchema,
  },
  responses: {
    200: {
      description: 'The shared project with read-only permissions and its scans',
      headers: rateLimitHeaders,
      content: {
        'application/json': {
          schema: sharedProjectDetailResponse,
        },
      },
    },
    ...commonErrorResponses,
  },
});

sharedProjectsOpenApiRegistry.registerPath({
  method: 'delete',
  path: '/api/v1/shared-projects/{projectId}',
  tags: ['Shared With Me'],
  summary: 'Remove a project from the current user’s Shared With Me list',
  description:
    'Viewer only. Revokes only the current user’s own access; the original project, the Owner, and other Viewers are unaffected.',
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: SharedProjectIdParamSchema,
  },
  responses: {
    200: {
      description: 'The project was removed from the Shared With Me list',
      headers: rateLimitHeaders,
      content: {
        'application/json': {
          schema: sharedProjectRemoveResponse,
        },
      },
    },
    ...commonErrorResponses,
  },
});
