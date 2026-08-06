import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

import { ErrorResponseSchema } from '../../common/schemas/error.js';
import { ProjectIdParamSchema } from '../project/project.schemas.js';
import {
  CreateScanBodySchema,
  ListScansQuerySchema,
  ScanIdParamSchema,
  ScanListResponseSchema,
  ScanResponseSchema,
  UpdateScanBodySchema,
} from './scan.schemas.js';

export const scanOpenApiRegistry = new OpenAPIRegistry();

const scanResponse = scanOpenApiRegistry.register('ScanResponse', ScanResponseSchema);
const scanListResponse = scanOpenApiRegistry.register('ScanListResponse', ScanListResponseSchema);
const createScanBody = scanOpenApiRegistry.register('CreateScanBody', CreateScanBodySchema);
const updateScanBody = scanOpenApiRegistry.register('UpdateScanBody', UpdateScanBodySchema);
const errorResponse = scanOpenApiRegistry.register('ScanErrorResponse', ErrorResponseSchema);

const bearerAuth = 'BearerAuth';

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

const projectNotFoundResponse = {
  description: 'The project is missing, deleted, or inaccessible to the current user',
  headers: rateLimitHeaders,
  content: {
    'application/json': {
      schema: errorResponse,
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

scanOpenApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/projects/{projectId}/scans',
  tags: ['Scans'],
  summary: 'Create scan metadata under a project',
  security: [{ [bearerAuth]: [] }],
  request: {
    params: ProjectIdParamSchema,
    body: {
      required: true,
      content: {
        'application/json': {
          schema: createScanBody,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'The scan was created',
      headers: rateLimitHeaders,
      content: {
        'application/json': {
          schema: scanResponse,
        },
      },
    },
    200: {
      description:
        'A scan already exists for the same project and clientMutationId (active or restored)',
      headers: rateLimitHeaders,
      content: {
        'application/json': {
          schema: scanResponse,
        },
      },
    },
    ...commonErrorResponses,
    404: projectNotFoundResponse,
  },
});

scanOpenApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/projects/{projectId}/scans',
  tags: ['Scans'],
  summary: 'List scans inside a project',
  security: [{ [bearerAuth]: [] }],
  request: {
    params: ProjectIdParamSchema,
    query: ListScansQuerySchema,
  },
  responses: {
    200: {
      description: 'A paginated list of scans',
      headers: rateLimitHeaders,
      content: {
        'application/json': {
          schema: scanListResponse,
        },
      },
    },
    ...commonErrorResponses,
    404: projectNotFoundResponse,
  },
});

scanOpenApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/scans/{scanId}',
  tags: ['Scans'],
  summary: 'Get scan detail as its Owner or an active Viewer of the parent project',
  security: [{ [bearerAuth]: [] }],
  request: {
    params: ScanIdParamSchema,
  },
  responses: {
    200: {
      description: 'The scan',
      headers: rateLimitHeaders,
      content: {
        'application/json': {
          schema: scanResponse,
        },
      },
    },
    ...commonErrorResponses,
    404: scanNotFoundResponse,
  },
});

scanOpenApiRegistry.registerPath({
  method: 'patch',
  path: '/api/v1/scans/{scanId}',
  tags: ['Scans'],
  summary: 'Partially update a scan as its project Owner',
  security: [{ [bearerAuth]: [] }],
  request: {
    params: ScanIdParamSchema,
    body: {
      required: true,
      content: {
        'application/json': {
          schema: updateScanBody,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'The updated scan',
      headers: rateLimitHeaders,
      content: {
        'application/json': {
          schema: scanResponse,
        },
      },
    },
    ...commonErrorResponses,
    404: scanNotFoundResponse,
  },
});

scanOpenApiRegistry.registerPath({
  method: 'delete',
  path: '/api/v1/scans/{scanId}',
  tags: ['Scans'],
  summary: 'Soft-delete a scan as its project Owner',
  security: [{ [bearerAuth]: [] }],
  request: {
    params: ScanIdParamSchema,
  },
  responses: {
    204: {
      description: 'The scan was deleted',
      headers: rateLimitHeaders,
    },
    ...commonErrorResponses,
    404: scanNotFoundResponse,
  },
});
