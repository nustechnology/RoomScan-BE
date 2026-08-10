import { OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';

import { APP_NAME, APP_VERSION } from '../config/constants.js';
import { authOpenApiRegistry } from '../modules/auth/auth.openapi.js';
import { healthOpenApiRegistry } from '../modules/health/health.openapi.js';
import { projectOpenApiRegistry } from '../modules/project/project.openapi.js';
import { scanOpenApiRegistry } from '../modules/scan/scan.openapi.js';
import { scanAssetOpenApiRegistry } from '../modules/scan-asset/scan-asset.openapi.js';

export function createOpenApiDocument(): ReturnType<OpenApiGeneratorV31['generateDocument']> {
  const generator = new OpenApiGeneratorV31([
    ...healthOpenApiRegistry.definitions,
    ...authOpenApiRegistry.definitions,
    ...projectOpenApiRegistry.definitions,
    ...scanOpenApiRegistry.definitions,
    ...scanAssetOpenApiRegistry.definitions,
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
      {
        name: 'Projects',
        description: 'Owner-managed projects with active Viewer detail access',
      },
      {
        name: 'Scans',
        description: 'Room scan metadata owned by a project',
      },
      {
        name: 'Scan Assets',
        description: 'Model and thumbnail asset upload and download for a scan',
      },
    ],
  });
}
