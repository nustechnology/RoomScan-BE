import { OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';

import { APP_NAME, APP_VERSION } from '../config/constants.js';
import { authOpenApiRegistry } from '../modules/auth/auth.openapi.js';
import { healthOpenApiRegistry } from '../modules/health/health.openapi.js';

export function createOpenApiDocument(): ReturnType<OpenApiGeneratorV31['generateDocument']> {
  const generator = new OpenApiGeneratorV31([
    ...healthOpenApiRegistry.definitions,
    ...authOpenApiRegistry.definitions,
  ]);

  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: `${APP_NAME} API`,
      version: APP_VERSION,
      description: 'HTTP API for the RoomScan backend.',
    },
    servers: [
      {
        url: '/',
        description: 'Current server',
      },
    ],
    tags: [
      {
        name: 'Health',
        description: 'Liveness and readiness endpoints',
      },
      {
        name: 'Auth',
        description: 'User authentication endpoints',
      },
    ],
  });
}
