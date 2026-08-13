import { describe, expect, it } from 'vitest';

import { hashIdempotencyRequest } from '../src/common/idempotency/request-hash.js';

describe('hashIdempotencyRequest', () => {
  it('produces a stable hash regardless of object key order', () => {
    const a = hashIdempotencyRequest('POST', '/api/v1/projects', {
      name: 'Test',
      description: 'Desc',
    });
    const b = hashIdempotencyRequest('POST', '/api/v1/projects', {
      description: 'Desc',
      name: 'Test',
    });

    expect(a).toBe(b);
  });

  it('distinguishes scalars, arrays, and null', () => {
    const arrayHash = hashIdempotencyRequest('POST', '/api/v1/projects', { tags: ['a', 'b'] });
    const nestedHash = hashIdempotencyRequest('POST', '/api/v1/projects', {
      meta: { a: 1, b: [1, 2] },
    });
    const nullHash = hashIdempotencyRequest('POST', '/api/v1/projects', null);

    expect(arrayHash).not.toBe(nestedHash);
    expect(nestedHash).not.toBe(nullHash);
    expect(arrayHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces a deterministic 64-character hex digest', () => {
    const hash = hashIdempotencyRequest('POST', '/api/v1/projects', { name: 'Test' });

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
