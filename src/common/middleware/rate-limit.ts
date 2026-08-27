import type { Request, RequestHandler, Response } from 'express';
import { rateLimit, type Logger as RateLimitLogger, type Store } from 'express-rate-limit';
import type { Logger } from 'pino';

import type { AppConfig } from '../../config/env.js';
import { AppError } from '../errors/app-error.js';

export interface RateLimiters {
  api: RequestHandler;
  appleAuth: RequestHandler;
  refreshAuth: RequestHandler;
  invitationCreate: RequestHandler;
  invitationAccept: RequestHandler;
  uploadSessionCreate: RequestHandler;
  downloadUrl: RequestHandler;
}

export interface RateLimitStores {
  api?: Store;
  appleAuth?: Store;
  refreshAuth?: Store;
  invitationCreate?: Store;
  invitationAccept?: Store;
  uploadSessionCreate?: Store;
  downloadUrl?: Store;
}

interface RateLimitPolicyOptions {
  identifier: string;
  windowSeconds: number;
  maxRequests: number;
  logger: RateLimitLogger;
  store?: Store;
  skip?: (request: Request, response: Response) => boolean;
}

function createRateLimitLogger(logger: Logger): RateLimitLogger {
  return {
    error(error, message) {
      logger.error({ err: error }, message ?? 'Rate limit middleware error');
    },
    warn(error, message) {
      logger.warn({ err: error }, message ?? 'Rate limit middleware warning');
    },
  };
}

function createRateLimiter({
  identifier,
  windowSeconds,
  maxRequests,
  logger,
  store,
  skip,
}: RateLimitPolicyOptions): RequestHandler {
  return rateLimit({
    windowMs: windowSeconds * 1000,
    limit: maxRequests,
    identifier,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    ipv6Subnet: 56,
    skipSuccessfulRequests: false,
    skipFailedRequests: false,
    passOnStoreError: true,
    logger,
    ...(store === undefined ? {} : { store }),
    ...(skip === undefined ? {} : { skip }),
    handler(_request, _response, next) {
      next(
        new AppError({
          statusCode: 429,
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests; please try again later',
        }),
      );
    },
  });
}

export function createRateLimiters(
  config: AppConfig,
  logger: Logger,
  stores: RateLimitStores = {},
): RateLimiters {
  const rateLimitLogger = createRateLimitLogger(logger);

  return {
    api: createRateLimiter({
      identifier: 'api',
      windowSeconds: config.apiRateLimitWindowSeconds,
      maxRequests: config.apiRateLimitMaxRequests,
      logger: rateLimitLogger,
      ...(stores.api === undefined ? {} : { store: stores.api }),
      skip(request) {
        return request.path === '/health' || request.path === '/ready';
      },
    }),
    appleAuth: createRateLimiter({
      identifier: 'auth-apple',
      windowSeconds: config.appleAuthRateLimitWindowSeconds,
      maxRequests: config.appleAuthRateLimitMaxRequests,
      logger: rateLimitLogger,
      ...(stores.appleAuth === undefined ? {} : { store: stores.appleAuth }),
    }),
    refreshAuth: createRateLimiter({
      identifier: 'auth-refresh',
      windowSeconds: config.refreshAuthRateLimitWindowSeconds,
      maxRequests: config.refreshAuthRateLimitMaxRequests,
      logger: rateLimitLogger,
      ...(stores.refreshAuth === undefined ? {} : { store: stores.refreshAuth }),
    }),
    invitationCreate: createRateLimiter({
      identifier: 'invitation-create',
      windowSeconds: config.invitationCreateRateLimitWindowSeconds,
      maxRequests: config.invitationCreateRateLimitMaxRequests,
      logger: rateLimitLogger,
      ...(stores.invitationCreate === undefined ? {} : { store: stores.invitationCreate }),
    }),
    invitationAccept: createRateLimiter({
      identifier: 'invitation-accept',
      windowSeconds: config.invitationAcceptRateLimitWindowSeconds,
      maxRequests: config.invitationAcceptRateLimitMaxRequests,
      logger: rateLimitLogger,
      ...(stores.invitationAccept === undefined ? {} : { store: stores.invitationAccept }),
    }),
    uploadSessionCreate: createRateLimiter({
      identifier: 'upload-session-create',
      windowSeconds: config.uploadSessionCreateRateLimitWindowSeconds,
      maxRequests: config.uploadSessionCreateRateLimitMaxRequests,
      logger: rateLimitLogger,
      ...(stores.uploadSessionCreate === undefined ? {} : { store: stores.uploadSessionCreate }),
    }),
    downloadUrl: createRateLimiter({
      identifier: 'download-url',
      windowSeconds: config.downloadUrlRateLimitWindowSeconds,
      maxRequests: config.downloadUrlRateLimitMaxRequests,
      logger: rateLimitLogger,
      ...(stores.downloadUrl === undefined ? {} : { store: stores.downloadUrl }),
    }),
  };
}
