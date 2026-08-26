import type { NextFunction, Request, RequestHandler, Response } from 'express';

import type { AppError } from '../errors/app-error.js';

export type ErrorMapper = (error: unknown) => AppError | undefined;
export type AsyncRouteHandler = (request: Request, response: Response) => Promise<void>;

export function composeErrorMappers(...mappers: ErrorMapper[]): ErrorMapper {
  return (error) => {
    for (const mapper of mappers) {
      const mapped = mapper(error);
      if (mapped !== undefined) return mapped;
    }
    return undefined;
  };
}

export function withErrorMapping(mapError: ErrorMapper) {
  return function route(handler: AsyncRouteHandler): RequestHandler {
    return (request: Request, response: Response, next: NextFunction) => {
      handler(request, response).catch((error: unknown) => {
        next(mapError(error) ?? error);
      });
    };
  };
}
