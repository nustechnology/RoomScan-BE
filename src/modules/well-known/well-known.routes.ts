import { Router } from 'express';

import { APPLE_APP_SITE_ASSOCIATION } from './apple-app-site-association.js';

export const APPLE_APP_SITE_ASSOCIATION_PATH = '/.well-known/apple-app-site-association';

export function createWellKnownRouter(): Router {
  const router = Router();

  router.get(APPLE_APP_SITE_ASSOCIATION_PATH, (_request, response) => {
    response.status(200).type('application/json').send(JSON.stringify(APPLE_APP_SITE_ASSOCIATION));
  });

  return router;
}
