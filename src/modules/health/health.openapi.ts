import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

import { ErrorResponseSchema } from '../../common/schemas/error.js';
import { HealthResponseSchema, ReadinessResponseSchema } from './health.schemas.js';

export const healthOpenApiRegistry = new OpenAPIRegistry();

const healthResponse = healthOpenApiRegistry.register('HealthResponse', HealthResponseSchema);
const readinessResponse = healthOpenApiRegistry.register(
  'ReadinessResponse',
  ReadinessResponseSchema,
);
const errorResponse = healthOpenApiRegistry.register('ErrorResponse', ErrorResponseSchema);

healthOpenApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/health',
  tags: ['Health'],
  summary: 'Check API liveness',
  responses: {
    200: {
      description: 'The API process is running',
      content: {
        'application/json': {
          schema: healthResponse,
        },
      },
    },
  },
});

healthOpenApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/ready',
  tags: ['Health'],
  summary: 'Check API readiness',
  responses: {
    200: {
      description: 'The API and PostgreSQL are ready',
      content: {
        'application/json': {
          schema: readinessResponse,
        },
      },
    },
    503: {
      description: 'PostgreSQL is unavailable',
      content: {
        'application/json': {
          schema: errorResponse,
        },
      },
    },
  },
});
