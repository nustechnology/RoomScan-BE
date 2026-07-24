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
      content: {
        'application/json': {
          schema: appleSignInResponse,
        },
      },
    },
    400: {
      description: 'The request body is invalid',
      content: {
        'application/json': {
          schema: authErrorResponse,
        },
      },
    },
    401: {
      description: 'The Apple identity token is invalid',
      content: {
        'application/json': {
          schema: authErrorResponse,
        },
      },
    },
    503: {
      description: 'Apple identity services are unavailable',
      content: {
        'application/json': {
          schema: authErrorResponse,
        },
      },
    },
    500: {
      description: 'An internal server error occurred',
      content: {
        'application/json': {
          schema: authErrorResponse,
        },
      },
    },
  },
});
