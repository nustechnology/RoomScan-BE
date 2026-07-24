import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

import { ErrorResponseSchema } from '../../common/schemas/error.js';
import { AppleSignInRequestSchema, AppleSignInResponseSchema } from './auth.schemas.js';

export const authOpenApiRegistry = new OpenAPIRegistry();

const appleSignInRequest = authOpenApiRegistry.register(
  'AppleSignInRequest',
  AppleSignInRequestSchema,
);
const appleSignInResponse = authOpenApiRegistry.register(
  'AppleSignInResponse',
  AppleSignInResponseSchema,
);
const authErrorResponse = authOpenApiRegistry.register('AuthErrorResponse', ErrorResponseSchema);

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

authOpenApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/auth/apple',
  tags: ['Auth'],
  summary: 'Authenticate with an Apple identity token',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: appleSignInRequest,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'The user was authenticated',
      headers: rateLimitHeaders,
      content: {
        'application/json': {
          schema: appleSignInResponse,
        },
      },
    },
    400: {
      description: 'The request body is invalid',
      headers: rateLimitHeaders,
      content: {
        'application/json': {
          schema: authErrorResponse,
        },
      },
    },
    401: {
      description: 'The Apple identity token is invalid',
      headers: rateLimitHeaders,
      content: {
        'application/json': {
          schema: authErrorResponse,
        },
      },
    },
    503: {
      description: 'Apple identity services are unavailable',
      headers: rateLimitHeaders,
      content: {
        'application/json': {
          schema: authErrorResponse,
        },
      },
    },
    500: {
      description: 'An internal server error occurred',
      headers: rateLimitHeaders,
      content: {
        'application/json': {
          schema: authErrorResponse,
        },
      },
    },
    429: {
      description: 'The client exceeded an API or Apple authentication rate limit',
      headers: {
        ...rateLimitHeaders,
        'Retry-After': {
          description: 'Seconds until the client may retry',
          schema: {
            type: 'integer',
            minimum: 0,
          },
        },
      },
      content: {
        'application/json': {
          schema: authErrorResponse,
        },
      },
    },
  },
});
