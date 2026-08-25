import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

import { ErrorResponseSchema } from '../../common/schemas/error.js';
import {
  GetMeResponseSchema,
  UpdateMeBodySchema,
  UserProfileResponseSchema,
} from './users.schemas.js';

export const usersOpenApiRegistry = new OpenAPIRegistry();

const bearerAuth = usersOpenApiRegistry.registerComponent('securitySchemes', 'BearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
});

const updateMeBody = usersOpenApiRegistry.register('UpdateMeRequest', UpdateMeBodySchema);
const userProfileResponse = usersOpenApiRegistry.register(
  'UserProfileResponse',
  UserProfileResponseSchema,
);
const getMeResponse = usersOpenApiRegistry.register('GetMeResponse', GetMeResponseSchema);
const userErrorResponse = usersOpenApiRegistry.register('UserErrorResponse', ErrorResponseSchema);

usersOpenApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/users/me',
  tags: ['Users'],
  summary: "Get the current user's profile",
  security: [{ [bearerAuth.name]: [] }],
  responses: {
    200: {
      description: 'The current user profile',
      content: {
        'application/json': {
          schema: getMeResponse,
        },
      },
    },
    401: {
      description: 'Missing or invalid access token',
      content: {
        'application/json': {
          schema: userErrorResponse,
        },
      },
    },
    404: {
      description: 'The current user was not found',
      content: {
        'application/json': {
          schema: userErrorResponse,
        },
      },
    },
    500: {
      description: 'An internal server error occurred',
      content: {
        'application/json': {
          schema: userErrorResponse,
        },
      },
    },
  },
});

usersOpenApiRegistry.registerPath({
  method: 'patch',
  path: '/api/v1/users/me',
  tags: ['Users'],
  summary: "Update the current user's display name",
  security: [{ [bearerAuth.name]: [] }],
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: updateMeBody,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'The current user profile was updated',
      content: {
        'application/json': {
          schema: userProfileResponse,
        },
      },
    },
    400: {
      description: 'The request body is invalid',
      content: {
        'application/json': {
          schema: userErrorResponse,
        },
      },
    },
    401: {
      description: 'Missing or invalid access token',
      content: {
        'application/json': {
          schema: userErrorResponse,
        },
      },
    },
    404: {
      description: 'The current user was not found',
      content: {
        'application/json': {
          schema: userErrorResponse,
        },
      },
    },
    500: {
      description: 'An internal server error occurred',
      content: {
        'application/json': {
          schema: userErrorResponse,
        },
      },
    },
  },
});
