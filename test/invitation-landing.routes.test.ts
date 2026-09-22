import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { notFoundHandler } from '../src/common/middleware/not-found.js';
import { errorHandler } from '../src/common/middleware/error-handler.js';
import { ErrorResponseSchema } from '../src/common/schemas/error.js';
import { createInvitationLandingRouter } from '../src/modules/invitation-landing/invitation-landing.routes.js';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abXYZ';

function buildApp(appleAppStoreId = ''): express.Express {
  const app = express();
  app.use(
    createInvitationLandingRouter({
      invitationBaseUrl: 'https://invite.roomscan.dev',
      appleAppStoreId,
    }),
  );
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe('invitation landing page', () => {
  it('renders the open page, custom-scheme button, and smart app banner', async () => {
    const response = await request(buildApp('123456789'))
      .get(`/invitations/${TOKEN}`)
      .query({ scope: 'project' })
      .expect(200);

    expect(response.headers['content-type']).toContain('text/html');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-robots-tag']).toBe('noindex');
    expect(response.text).toContain('Open app to accept the invitation');
    expect(response.text).toContain(`href="roomscan://invitations/${TOKEN}?scope=project"`);
    expect(response.text).toContain(
      `content="app-id=123456789, app-argument=https://invite.roomscan.dev/invitations/${TOKEN}?scope=project"`,
    );
  });

  it('omits the scope query and smart app banner when not configured', async () => {
    const response = await request(buildApp()).get(`/invitations/${TOKEN}`).expect(200);

    expect(response.text).toContain(`href="roomscan://invitations/${TOKEN}"`);
    expect(response.text).not.toContain('apple-itunes-app');
  });

  it('ignores an unknown scope value', async () => {
    const response = await request(buildApp())
      .get(`/invitations/${TOKEN}`)
      .query({ scope: 'other' })
      .expect(200);

    expect(response.text).toContain(`href="roomscan://invitations/${TOKEN}"`);
  });

  it('falls through to the standard not-found response for a malformed token', async () => {
    const response = await request(buildApp()).get('/invitations/not-a-token').expect(404);
    const body = ErrorResponseSchema.parse(response.body as unknown);

    expect(body.error.code).toBe('NOT_FOUND');
  });
});
