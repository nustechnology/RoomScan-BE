import { Router } from 'express';

import { INVITATION_TOKEN_PATTERN } from '../../common/identifiers/invitation-reference.js';
import {
  buildInvitationLandingPage,
  type InvitationLandingScope,
} from './invitation-landing.page.js';

export const INVITATION_LANDING_PATH = '/invitations/:token';

export interface InvitationLandingRouterDependencies {
  invitationBaseUrl: string;
  appleAppStoreId: string;
}

function parseScope(value: unknown): InvitationLandingScope | null {
  return value === 'project' || value === 'scan' ? value : null;
}

export function createInvitationLandingRouter({
  invitationBaseUrl,
  appleAppStoreId,
}: InvitationLandingRouterDependencies): Router {
  const router = Router();

  router.get(INVITATION_LANDING_PATH, (request, response, next) => {
    const token = request.params.token;

    if (typeof token !== 'string' || !INVITATION_TOKEN_PATTERN.test(token)) {
      next();
      return;
    }

    response
      .status(200)
      .set('content-type', 'text/html; charset=utf-8')
      .set('cache-control', 'no-store')
      .set('x-robots-tag', 'noindex')
      .send(
        buildInvitationLandingPage({
          token,
          scope: parseScope(request.query.scope),
          invitationBaseUrl,
          appleAppStoreId,
        }),
      );
  });

  return router;
}
