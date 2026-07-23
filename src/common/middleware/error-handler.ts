import type { ErrorRequestHandler, Request } from 'express';
import type { Logger } from 'pino';
import { ZodError } from 'zod';

import { AppError } from '../errors/app-error.js';
import { getRequestId } from '../http/request-id.js';
import { ErrorResponseSchema } from '../schemas/error.js';

interface HttpErrorLike extends Error {
  status?: number;
  statusCode?: number;
}

function isHttpError(error: unknown): error is HttpErrorLike {
  if (!(error instanceof Error)) {
    return false;
  }

  const candidate = error as HttpErrorLike;
  return (
    (typeof candidate.status === 'number' && candidate.status >= 400) ||
    (typeof candidate.statusCode === 'number' && candidate.statusCode >= 400)
  );
}

export const errorHandler: ErrorRequestHandler = (error, request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  const requestId = getRequestId(request);
  const requestLogger: Logger | undefined = (request as Request & { log?: Logger }).log;

  let statusCode = 500;
  let code = 'INTERNAL_SERVER_ERROR';
  let message = 'An unexpected error occurred';
  let details: unknown;

  if (error instanceof AppError) {
    statusCode = error.statusCode;
    code = error.code;
    message = error.message;
    details = error.details;
  } else if (error instanceof ZodError) {
    statusCode = 400;
    code = 'VALIDATION_ERROR';
    message = 'Request validation failed';
    details = error.issues;
  } else if (isHttpError(error)) {
    statusCode = error.status ?? error.statusCode ?? 500;
    code = statusCode === 400 ? 'BAD_REQUEST' : 'HTTP_ERROR';
    message = statusCode === 400 ? 'Invalid request payload' : error.message;
  }

  const body = ErrorResponseSchema.parse({
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
    requestId,
  });

  if (statusCode >= 500) {
    requestLogger?.error({ err: error, requestId }, 'Request failed');
  } else {
    requestLogger?.warn({ err: error, requestId }, 'Request rejected');
  }

  response.status(statusCode).json(body);
};
