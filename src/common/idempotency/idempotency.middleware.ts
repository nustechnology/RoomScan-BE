import type { RequestHandler } from 'express';

import { AppError } from '../errors/app-error.js';
import { getUserId } from '../middleware/authenticate.js';
import { IdempotencyKeyInProgressError } from './idempotency.errors.js';
import type { IdempotencyRepository } from './idempotency.types.js';
import { hashIdempotencyRequest } from './request-hash.js';

export interface IdempotencyMiddlewareDependencies {
  repository: IdempotencyRepository;
  clock?: () => Date;
  ttlSeconds: number;
}

export function idempotencyMiddleware({
  repository,
  clock,
  ttlSeconds,
}: IdempotencyMiddlewareDependencies): RequestHandler {
  const now = clock ?? (() => new Date());

  function mismatchError(): AppError {
    return new AppError({
      statusCode: 409,
      code: 'IDEMPOTENCY_KEY_MISMATCH',
      message: 'Idempotency-Key was already used with a different request body',
    });
  }

  function inProgressError(): AppError {
    return new AppError({
      statusCode: 409,
      code: 'IDEMPOTENCY_KEY_IN_PROGRESS',
      message: 'A request with the same Idempotency-Key is already being processed',
    });
  }

  return async (request, response, next) => {
    const rawKey = request.headers['idempotency-key'];

    if (typeof rawKey !== 'string' || rawKey.trim().length === 0) {
      next();
      return;
    }

    const key = rawKey.trim();
    if (key.length > 128) {
      next(
        new AppError({
          statusCode: 400,
          code: 'VALIDATION_ERROR',
          message: 'Idempotency-Key must be at most 128 characters',
        }),
      );
      return;
    }

    const userId = getUserId(request);
    const requestHash = hashIdempotencyRequest(request.method, request.originalUrl, request.body);

    const existing = await repository.findByUserAndKey(userId, key);
    if (existing !== null && existing.expiresAt.getTime() > now().getTime()) {
      if (existing.requestHash !== requestHash) {
        next(mismatchError());
        return;
      }
      if (existing.statusCode === 0) {
        next(inProgressError());
        return;
      }
      response.status(existing.statusCode).json(existing.responseBody);
      return;
    }

    try {
      await repository.reserve({
        userId,
        key,
        requestHash,
        expiresAt: new Date(now().getTime() + ttlSeconds * 1000),
      });
    } catch (error) {
      if (error instanceof IdempotencyKeyInProgressError) {
        const concurrent = await repository.findByUserAndKey(userId, key);
        if (concurrent !== null) {
          if (concurrent.requestHash !== requestHash) {
            next(mismatchError());
            return;
          }
          if (concurrent.statusCode === 0) {
            next(inProgressError());
            return;
          }
          response.status(concurrent.statusCode).json(concurrent.responseBody);
          return;
        }
      }
      next(error);
      return;
    }

    const originalJson = response.json.bind(response);
    let settled = false;
    response.json = (body: unknown) => {
      if (!settled) {
        settled = true;
        if (response.statusCode >= 200 && response.statusCode < 300) {
          void repository.finalize(userId, key, response.statusCode, body).catch(() => {
            // A failed finalize must not surface after the response was committed.
          });
        } else {
          // Do not cache error responses: release the reserved key so a retry
          // with the same Idempotency-Key can attempt the mutation again.
          void repository.release(userId, key).catch(() => {
            // A failed release must not surface after the response was committed.
          });
        }
      }
      return originalJson(body);
    };

    next();
  };
}
