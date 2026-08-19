import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

import { ErrorResponseSchema } from '../../common/schemas/error.js';
import {
  IdempotencyKeyHeaderSchema,
  IfMatchHeaderSchema,
} from '../../common/schemas/sync-headers.js';
import {
  CreateProjectBodySchema,
  ListProjectsQuerySchema,
  ProjectIdParamSchema,
  ProjectListResponseSchema,
  ProjectResponseSchema,
  UpdateProjectBodySchema,
} from './project.schemas.js';

export const projectOpenApiRegistry = new OpenAPIRegistry();

const bearerAuth = projectOpenApiRegistry.registerComponent('securitySchemes', 'BearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
});

const projectResponse = projectOpenApiRegistry.register('ProjectResponse', ProjectResponseSchema);
const projectListResponse = projectOpenApiRegistry.register(
  'ProjectListResponse',
  ProjectListResponseSchema,
);
const createProjectBody = projectOpenApiRegistry.register(
  'CreateProjectBody',
  CreateProjectBodySchema,
);
const updateProjectBody = projectOpenApiRegistry.register(
  'UpdateProjectBody',
  UpdateProjectBodySchema,
);
const errorResponse = projectOpenApiRegistry.register('ProjectErrorResponse', ErrorResponseSchema);

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

const revisionHeaders = {
  ...rateLimitHeaders,
  ETag: {
    description: 'Strong ETag containing the current resource revision',
    schema: { type: 'string' as const, example: '"3"' },
  },
};

const conflictResponse = {
  description: 'The revision is stale or the idempotency key was reused with another payload',
  headers: rateLimitHeaders,
  content: { 'application/json': { schema: errorResponse } },
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

const projectNotFoundResponse = {
  description: 'The project is missing, deleted, or inaccessible to the current user',
  headers: rateLimitHeaders,
  content: {
    'application/json': {
      schema: errorResponse,
    },
  },
};

projectOpenApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/projects',
  tags: ['Projects'],
  summary: 'Create a project',
  description: 'Requires Idempotency-Key. A successful retry replays the original 201 response.',
  security: [{ [bearerAuth.name]: [] }],
  request: {
    headers: IdempotencyKeyHeaderSchema,
    body: {
      required: true,
      content: {
        'application/json': {
          schema: createProjectBody,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'The project was created',
      headers: revisionHeaders,
      content: {
        'application/json': {
          schema: projectResponse,
        },
      },
    },
    ...commonErrorResponses,
    409: conflictResponse,
  },
});

projectOpenApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/projects',
  tags: ['Projects'],
  summary: 'List the authenticated user’s projects',
  security: [{ [bearerAuth.name]: [] }],
  request: {
    query: ListProjectsQuerySchema,
  },
  responses: {
    200: {
      description: 'A paginated list of projects',
      headers: rateLimitHeaders,
      content: {
        'application/json': {
          schema: projectListResponse,
        },
      },
    },
    ...commonErrorResponses,
  },
});

projectOpenApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/projects/{projectId}',
  tags: ['Projects'],
  summary: 'Get a project as its Owner or an active Viewer',
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: ProjectIdParamSchema,
  },
  responses: {
    200: {
      description: 'The project',
      headers: revisionHeaders,
      content: {
        'application/json': {
          schema: projectResponse,
        },
      },
    },
    ...commonErrorResponses,
    404: projectNotFoundResponse,
  },
});

projectOpenApiRegistry.registerPath({
  method: 'patch',
  path: '/api/v1/projects/{projectId}',
  tags: ['Projects'],
  summary: 'Partially update a project',
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: ProjectIdParamSchema,
    headers: IfMatchHeaderSchema,
    body: {
      required: true,
      content: {
        'application/json': {
          schema: updateProjectBody,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'The updated project',
      headers: revisionHeaders,
      content: {
        'application/json': {
          schema: projectResponse,
        },
      },
    },
    ...commonErrorResponses,
    404: projectNotFoundResponse,
    409: conflictResponse,
  },
});

projectOpenApiRegistry.registerPath({
  method: 'delete',
  path: '/api/v1/projects/{projectId}',
  tags: ['Projects'],
  summary: 'Soft-delete an owned project',
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: ProjectIdParamSchema,
    headers: IfMatchHeaderSchema,
  },
  responses: {
    204: {
      description: 'The project was deleted',
      headers: revisionHeaders,
    },
    ...commonErrorResponses,
    404: projectNotFoundResponse,
    409: conflictResponse,
  },
});
