import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { errorHandler } from '../src/common/middleware/error-handler.js';
import { validateRequest } from '../src/common/middleware/validate-request.js';
import { ErrorResponseSchema } from '../src/common/schemas/error.js';

function createValidationApp() {
  const app = express();

  app.get(
    '/validate',
    validateRequest({
      query: z.object({
        limit: z.coerce.number().int().positive(),
      }),
    }),
    (_request, response) => {
      response.status(200).json(response.locals.validated);
    },
  );
  app.get('/http-error', (_request, _response, next) => {
    next(Object.assign(new Error('Short and stout'), { statusCode: 418 }));
  });
  app.get('/internal-error', (_request, _response, next) => {
    next('non-error rejection');
  });
  app.use(errorHandler);

  return app;
}

describe('validateRequest', () => {
  it('stores parsed input for downstream handlers', async () => {
    const response = await request(createValidationApp()).get('/validate?limit=5').expect(200);
    const body = z
      .object({
        query: z.object({
          limit: z.number(),
        }),
      })
      .parse(response.body as unknown);

    expect(body).toEqual({
      query: {
        limit: 5,
      },
    });
  });

  it('forwards Zod errors to the standard error handler', async () => {
    const response = await request(createValidationApp())
      .get('/validate?limit=invalid')
      .expect(400);
    const body = ErrorResponseSchema.parse(response.body as unknown);

    expect(body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
    });
    expect(body.error.details).toEqual(expect.any(Array));
    expect(body.requestId).toEqual(expect.any(String));
  });

  it('normalizes dependency HTTP errors', async () => {
    const response = await request(createValidationApp()).get('/http-error').expect(418);
    const body = ErrorResponseSchema.parse(response.body as unknown);

    expect(body.error).toEqual({
      code: 'HTTP_ERROR',
      message: 'Short and stout',
    });
  });

  it('hides unknown internal errors', async () => {
    const response = await request(createValidationApp()).get('/internal-error').expect(500);
    const body = ErrorResponseSchema.parse(response.body as unknown);

    expect(body.error).toEqual({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
    });
    expect(JSON.stringify(body)).not.toContain('non-error rejection');
  });
});
