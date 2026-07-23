import type { RequestHandler } from 'express';

import { AppError } from '../errors/app-error.js';

export const notFoundHandler: RequestHandler = (request, _response, next) => {
  next(
    new AppError({
      statusCode: 404,
      code: 'NOT_FOUND',
      message: `Route ${request.method} ${request.originalUrl} was not found`,
    }),
  );
};
