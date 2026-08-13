import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../src/common/errors/app-error.js';
import { IdempotencyKeyInProgressError } from '../src/common/idempotency/idempotency.errors.js';
import { idempotencyMiddleware } from '../src/common/idempotency/idempotency.middleware.js';
import { hashIdempotencyRequest } from '../src/common/idempotency/request-hash.js';
import type {
  IdempotencyRecord,
  IdempotencyRepository,
} from '../src/common/idempotency/idempotency.types.js';

const USER_ID = 'eb5d278f-c857-45c7-887d-7be65288cb75';
const KEY = 'create-project-abc';
const NOW = new Date('2026-07-29T10:00:00.000Z');

function record(overrides: Partial<IdempotencyRecord> = {}): IdempotencyRecord {
  return {
    id: 'idempotency-1',
    userId: USER_ID,
    key: KEY,
    requestHash: 'hash',
    statusCode: 201,
    responseBody: { id: 'project-1', name: 'Test' },
    createdAt: NOW,
    expiresAt: new Date(NOW.getTime() + 86_400_000),
    ...overrides,
  };
}

function createRepository() {
  return {
    repository: {
      findByUserAndKey: vi.fn<IdempotencyRepository['findByUserAndKey']>().mockResolvedValue(null),
      reserve: vi.fn<IdempotencyRepository['reserve']>().mockResolvedValue(undefined),
      finalize: vi.fn<IdempotencyRepository['finalize']>().mockResolvedValue(undefined),
      release: vi.fn<IdempotencyRepository['release']>().mockResolvedValue(undefined),
    },
  };
}

type MockNext = NextFunction & { mock: { calls: unknown[][] } };

function createRequestContext(body: unknown, headers: Record<string, string> = {}) {
  const request = {
    headers: { ...headers },
    method: 'POST',
    originalUrl: '/api/v1/projects',
    body,
    locals: { currentUser: { id: USER_ID, email: 'owner@example.com' } },
  } as unknown as Request;
  const statusCodeHolder = { value: 200 };
  const jsonSpy = vi.fn().mockReturnThis();
  const statusSpy = vi.fn((code: number) => {
    statusCodeHolder.value = code;
    return response;
  });
  const response = {
    json: jsonSpy,
    status: statusSpy,
    get statusCode(): number {
      return statusCodeHolder.value;
    },
    set statusCode(value: number) {
      statusCodeHolder.value = value;
    },
  } as unknown as Response;
  const next = vi.fn<NextFunction>() as unknown as MockNext;
  return { request, response, next, jsonSpy, statusSpy };
}

function nextError(next: MockNext): AppError {
  return next.mock.calls[0]?.[0] as AppError;
}

describe('idempotencyMiddleware', () => {
  it('skips requests without an Idempotency-Key', async () => {
    const { repository } = createRepository();
    const middleware = idempotencyMiddleware({ repository, clock: () => NOW, ttlSeconds: 86_400 });
    const { request, response, next } = createRequestContext({ name: 'Test' });

    await middleware(request, response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(repository.findByUserAndKey).not.toHaveBeenCalled();
  });

  it('reserves a key and finalizes a 2xx response', async () => {
    const { repository } = createRepository();
    const middleware = idempotencyMiddleware({ repository, clock: () => NOW, ttlSeconds: 86_400 });
    const { request, response, next } = createRequestContext(
      { name: 'Test' },
      { 'idempotency-key': KEY },
    );

    await middleware(request, response, next);

    expect(repository.reserve).toHaveBeenCalledWith({
      userId: USER_ID,
      key: KEY,
      requestHash: hashIdempotencyRequest('POST', '/api/v1/projects', { name: 'Test' }),
      expiresAt: new Date(NOW.getTime() + 86_400_000),
    });
    expect(next).toHaveBeenCalledOnce();

    response.status(201);
    (response.json as unknown as (body: unknown) => unknown)({ id: 'project-1' });

    expect(repository.finalize).toHaveBeenCalledWith(USER_ID, KEY, 201, { id: 'project-1' });
  });

  it('releases the key on an error response so a retry can succeed', async () => {
    const { repository } = createRepository();
    const middleware = idempotencyMiddleware({ repository, clock: () => NOW, ttlSeconds: 86_400 });
    const { request, response, next } = createRequestContext(
      { name: 'Test' },
      { 'idempotency-key': KEY },
    );

    await middleware(request, response, next);
    response.status(500);
    (response.json as unknown as (body: unknown) => unknown)({
      error: { code: 'INTERNAL_SERVER_ERROR' },
    });

    expect(repository.finalize).not.toHaveBeenCalled();
    expect(repository.release).toHaveBeenCalledWith(USER_ID, KEY);
  });

  it('replays a finalized record when the request hash matches', async () => {
    const { repository } = createRepository();
    const requestHash = hashIdempotencyRequest('POST', '/api/v1/projects', { name: 'Test' });
    repository.findByUserAndKey.mockResolvedValue(record({ requestHash }));
    const middleware = idempotencyMiddleware({ repository, clock: () => NOW, ttlSeconds: 86_400 });
    const { request, response, next, statusSpy, jsonSpy } = createRequestContext(
      { name: 'Test' },
      { 'idempotency-key': KEY },
    );

    await middleware(request, response, next);

    expect(statusSpy).toHaveBeenCalledWith(201);
    expect(jsonSpy).toHaveBeenCalledWith({ id: 'project-1', name: 'Test' });
    expect(next).not.toHaveBeenCalled();
    expect(repository.reserve).not.toHaveBeenCalled();
  });

  it('returns 409 when the same key is reused with a different body', async () => {
    const { repository } = createRepository();
    const requestHash = hashIdempotencyRequest('POST', '/api/v1/projects', { name: 'Original' });
    repository.findByUserAndKey.mockResolvedValue(record({ requestHash }));
    const middleware = idempotencyMiddleware({ repository, clock: () => NOW, ttlSeconds: 86_400 });
    const { request, response, next } = createRequestContext(
      { name: 'Changed' },
      { 'idempotency-key': KEY },
    );

    await middleware(request, response, next);

    const error = nextError(next);
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(409);
    expect(error.code).toBe('IDEMPOTENCY_KEY_MISMATCH');
  });

  it('returns 409 while a concurrent request with the same key is in progress', async () => {
    const { repository } = createRepository();
    const requestHash = hashIdempotencyRequest('POST', '/api/v1/projects', { name: 'Test' });
    repository.findByUserAndKey.mockResolvedValue(
      record({ requestHash, statusCode: 0, responseBody: null }),
    );
    const middleware = idempotencyMiddleware({ repository, clock: () => NOW, ttlSeconds: 86_400 });
    const { request, response, next } = createRequestContext(
      { name: 'Test' },
      { 'idempotency-key': KEY },
    );

    await middleware(request, response, next);

    const error = nextError(next);
    expect(error.statusCode).toBe(409);
    expect(error.code).toBe('IDEMPOTENCY_KEY_IN_PROGRESS');
  });

  it('resolves a concurrent reserve race to the winning request', async () => {
    const { repository } = createRepository();
    const requestHash = hashIdempotencyRequest('POST', '/api/v1/projects', { name: 'Test' });
    repository.findByUserAndKey
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(record({ requestHash }));
    repository.reserve.mockRejectedValue(new IdempotencyKeyInProgressError());
    const middleware = idempotencyMiddleware({ repository, clock: () => NOW, ttlSeconds: 86_400 });
    const { request, response, next, statusSpy, jsonSpy } = createRequestContext(
      { name: 'Test' },
      { 'idempotency-key': KEY },
    );

    await middleware(request, response, next);

    expect(statusSpy).toHaveBeenCalledWith(201);
    expect(jsonSpy).toHaveBeenCalledWith({ id: 'project-1', name: 'Test' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 409 when a concurrent reserve race produces a payload mismatch', async () => {
    const { repository } = createRepository();
    const originalHash = hashIdempotencyRequest('POST', '/api/v1/projects', { name: 'Original' });
    repository.findByUserAndKey
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(record({ requestHash: originalHash }));
    repository.reserve.mockRejectedValue(new IdempotencyKeyInProgressError());
    const middleware = idempotencyMiddleware({ repository, clock: () => NOW, ttlSeconds: 86_400 });
    const { request, response, next } = createRequestContext(
      { name: 'Changed' },
      { 'idempotency-key': KEY },
    );

    await middleware(request, response, next);

    const error = nextError(next);
    expect(error.statusCode).toBe(409);
    expect(error.code).toBe('IDEMPOTENCY_KEY_MISMATCH');
  });

  it('forwards an unexpected reserve failure to the error middleware', async () => {
    const { repository } = createRepository();
    repository.reserve.mockRejectedValue(new Error('database is down'));
    const middleware = idempotencyMiddleware({ repository, clock: () => NOW, ttlSeconds: 86_400 });
    const { request, response, next } = createRequestContext(
      { name: 'Test' },
      { 'idempotency-key': KEY },
    );

    await middleware(request, response, next);

    const error = nextError(next);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('database is down');
  });

  it('treats an expired record as absent and reserves a fresh one', async () => {
    const { repository } = createRepository();
    repository.findByUserAndKey.mockResolvedValue(
      record({ expiresAt: new Date(NOW.getTime() - 1000) }),
    );
    const middleware = idempotencyMiddleware({ repository, clock: () => NOW, ttlSeconds: 86_400 });
    const { request, response, next } = createRequestContext(
      { name: 'Test' },
      { 'idempotency-key': KEY },
    );

    await middleware(request, response, next);

    expect(repository.reserve).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects an over-length key with a validation error', async () => {
    const { repository } = createRepository();
    const middleware = idempotencyMiddleware({ repository, clock: () => NOW, ttlSeconds: 86_400 });
    const { request, response, next } = createRequestContext(
      { name: 'Test' },
      { 'idempotency-key': 'k'.repeat(129) },
    );

    await middleware(request, response, next);

    const error = nextError(next);
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe('VALIDATION_ERROR');
  });
});
