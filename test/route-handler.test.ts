import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../src/common/errors/app-error.js';
import { composeErrorMappers, withErrorMapping } from '../src/common/http/route-handler.js';

describe('composeErrorMappers', () => {
  it('returns the first mapper result that is defined', () => {
    const first = vi.fn(() => undefined);
    const second = vi.fn(
      () => new AppError({ statusCode: 404, code: 'NOT_FOUND', message: 'not found' }),
    );
    const third = vi.fn(
      () => new AppError({ statusCode: 409, code: 'CONFLICT', message: 'conflict' }),
    );

    const mapped = composeErrorMappers(first, second, third)(new Error('boom'));

    expect(mapped?.code).toBe('NOT_FOUND');
    expect(third).not.toHaveBeenCalled();
  });

  it('returns undefined when no mapper matches', () => {
    const mapped = composeErrorMappers(
      () => undefined,
      () => undefined,
    )(new Error('boom'));

    expect(mapped).toBeUndefined();
  });
});

describe('withErrorMapping', () => {
  function createMocks() {
    const request = {} as Request;
    const response = {} as Response;
    const next = vi.fn() as NextFunction;
    return { request, response, next };
  }

  it('does not call next when the handler resolves', async () => {
    const { request, response, next } = createMocks();
    const route = withErrorMapping(() => undefined);
    const handler = route(async () => {});

    handler(request, response, next);
    await new Promise((resolve) => setImmediate(resolve));

    expect(next).not.toHaveBeenCalled();
  });

  it('forwards the mapped error when the handler rejects', async () => {
    const { request, response, next } = createMocks();
    const mapped = new AppError({ statusCode: 404, code: 'NOT_FOUND', message: 'not found' });
    const route = withErrorMapping(() => mapped);
    const handler = route(() => Promise.reject(new Error('boom')));

    handler(request, response, next);
    await new Promise((resolve) => setImmediate(resolve));

    expect(next).toHaveBeenCalledWith(mapped);
  });

  it('forwards the raw error when nothing maps it', async () => {
    const { request, response, next } = createMocks();
    const raw = new Error('boom');
    const route = withErrorMapping(() => undefined);
    const handler = route(() => Promise.reject(raw));

    handler(request, response, next);
    await new Promise((resolve) => setImmediate(resolve));

    expect(next).toHaveBeenCalledWith(raw);
  });
});
