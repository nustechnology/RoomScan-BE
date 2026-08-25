import type { Request, RequestHandler } from 'express';

import { AppError } from '../errors/app-error.js';

export interface VerifiedAccessToken {
  userId: string;
}

export interface AccessTokenVerifier {
  verify(accessToken: string): Promise<VerifiedAccessToken>;
}

export interface CurrentUser {
  id: string;
  email: string | null;
  displayName: string | null;
}

export interface CurrentUserRepository {
  findById(userId: string): Promise<CurrentUser | null>;
  updateDisplayName(userId: string, displayName: string | null): Promise<CurrentUser | null>;
}

export interface AuthenticatedLocals {
  currentUser: CurrentUser;
}

declare module 'express-serve-static-core' {
  interface Request {
    locals?: AuthenticatedLocals;
  }
}

export class InvalidAccessTokenError extends Error {
  constructor() {
    super('Access token is invalid');
    this.name = 'InvalidAccessTokenError';
  }
}

function extractBearerToken(authorization: string | undefined): string {
  if (typeof authorization !== 'string') {
    throw new InvalidAccessTokenError();
  }

  const [scheme, token, ...remainder] = authorization.split(' ');

  if (scheme !== 'Bearer' || token === undefined || remainder.length > 0) {
    throw new InvalidAccessTokenError();
  }

  return token;
}

export function authenticate(
  verifier: AccessTokenVerifier,
  currentUserRepository: CurrentUserRepository,
): RequestHandler {
  return async (request, _response, next) => {
    try {
      const token = extractBearerToken(request.headers.authorization);
      const { userId } = await verifier.verify(token);
      const currentUser = await currentUserRepository.findById(userId);

      if (currentUser === null) {
        throw new InvalidAccessTokenError();
      }

      request.locals = { currentUser };
      next();
    } catch (error) {
      if (error instanceof InvalidAccessTokenError) {
        next(
          new AppError({
            statusCode: 401,
            code: 'UNAUTHORIZED',
            message: 'Authentication is required',
          }),
        );
        return;
      }

      next(error);
    }
  };
}

export function getUserId(request: Request): string {
  const locals = request.locals;

  if (locals === undefined) {
    throw new Error('Authentication middleware did not populate request.locals');
  }

  return locals.currentUser.id;
}

export function optionalAuthenticate(
  verifier: AccessTokenVerifier,
  currentUserRepository: CurrentUserRepository,
): RequestHandler {
  return async (request, _response, next) => {
    const authorization = request.headers.authorization;

    if (typeof authorization !== 'string' || authorization.length === 0) {
      next();
      return;
    }

    try {
      const token = extractBearerToken(authorization);
      const { userId } = await verifier.verify(token);
      const currentUser = await currentUserRepository.findById(userId);

      if (currentUser !== null) {
        request.locals = { currentUser };
      }

      next();
    } catch (error) {
      if (error instanceof InvalidAccessTokenError) {
        next();
        return;
      }

      next(error);
    }
  };
}
