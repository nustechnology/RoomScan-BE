import { OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';

import { APP_NAME, APP_VERSION } from '../config/constants.js';
import { authOpenApiRegistry } from '../modules/auth/auth.openapi.js';
import { healthOpenApiRegistry } from '../modules/health/health.openapi.js';
import { projectOpenApiRegistry } from '../modules/project/project.openapi.js';
import { scanOpenApiRegistry } from '../modules/scan/scan.openapi.js';
import { scanAssetOpenApiRegistry } from '../modules/scan-asset/scan-asset.openapi.js';
import { noteOpenApiRegistry } from '../modules/note/note.openapi.js';
import { shareOpenApiRegistry } from '../modules/share/share.openapi.js';
import { sharedProjectsOpenApiRegistry } from '../modules/shared-projects/shared-projects.openapi.js';
import { sharedScansOpenApiRegistry } from '../modules/shared-scans/shared-scans.openapi.js';
import { syncOpenApiRegistry } from '../modules/sync/sync.openapi.js';

export function createOpenApiDocument(): ReturnType<OpenApiGeneratorV31['generateDocument']> {
  const generator = new OpenApiGeneratorV31([
    ...healthOpenApiRegistry.definitions,
    ...authOpenApiRegistry.definitions,
    ...projectOpenApiRegistry.definitions,
    ...scanOpenApiRegistry.definitions,
    ...scanAssetOpenApiRegistry.definitions,
    ...noteOpenApiRegistry.definitions,
    ...shareOpenApiRegistry.definitions,
    ...sharedProjectsOpenApiRegistry.definitions,
    ...sharedScansOpenApiRegistry.definitions,
    ...syncOpenApiRegistry.definitions,
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
      {
        name: 'Notes',
        description: 'Text notes anchored to 3D positions inside scan models',
      },
      {
        name: 'Shares',
        description: 'Project sharing through expiring invitation links and Viewer access',
      },
      {
        name: 'Shared With Me',
        description: 'Projects and scans accepted by the current user as a Viewer',
      },
      {
        name: 'Sync',
        description: 'Offline-first change feed, conflict recovery, and project sync readiness',
      },
    ],
  });
}
