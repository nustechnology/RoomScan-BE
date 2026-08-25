import { describe, expect, it } from 'vitest';

import {
  buildOrderBy,
  buildSearchWhere,
  paginatedResponseSchema,
  paginationQuerySchema,
  searchQuerySchema,
  toPaginationMeta,
  toSkipTake,
} from '../src/common/pagination/pagination.js';
import { z } from '../src/openapi/zod.js';

describe('paginationQuerySchema', () => {
  it('applies the given default limit and page 1 when omitted', () => {
    const schema = paginationQuerySchema(20);
    expect(schema.parse({})).toEqual({ page: 1, limit: 20 });
  });

  it('coerces string query values to numbers', () => {
    const schema = paginationQuerySchema(20);
    expect(schema.parse({ page: '2', limit: '10' })).toEqual({ page: 2, limit: 10 });
  });

  it('rejects a limit above 100', () => {
    const schema = paginationQuerySchema(20);
    expect(() => schema.parse({ limit: 101 })).toThrow();
  });

  it('rejects a page below 1', () => {
    const schema = paginationQuerySchema(20);
    expect(() => schema.parse({ page: 0 })).toThrow();
  });

  it.each([0, 101, 1.5, -5])(
    'throws when constructed with an invalid defaultLimit (%s) instead of silently accepting it',
    (defaultLimit) => {
      expect(() => paginationQuerySchema(defaultLimit)).toThrow();
    },
  );
});

describe('searchQuerySchema', () => {
  it('treats a blank string as absent', () => {
    expect(searchQuerySchema().parse('')).toBeUndefined();
  });

  it('trims and passes through a non-blank string', () => {
    expect(searchQuerySchema().parse('  apartment  ')).toBe('apartment');
  });

  it('rejects a string longer than 50 characters', () => {
    expect(() => searchQuerySchema().parse('a'.repeat(51))).toThrow();
  });
});

describe('paginatedResponseSchema', () => {
  it('wraps the item schema in an items/pagination envelope', () => {
    const schema = paginatedResponseSchema(z.object({ id: z.string() }));
    const parsed = schema.parse({
      items: [{ id: 'a' }],
      pagination: { page: 1, limit: 5, total: 1, totalPages: 1 },
    });
    expect(parsed.items).toEqual([{ id: 'a' }]);
    expect(parsed.pagination).toEqual({ page: 1, limit: 5, total: 1, totalPages: 1 });
  });
});

describe('toSkipTake', () => {
  it('computes skip from page and limit', () => {
    expect(toSkipTake({ page: 1, limit: 20 })).toEqual({ skip: 0, take: 20 });
    expect(toSkipTake({ page: 3, limit: 10 })).toEqual({ skip: 20, take: 10 });
  });
});

describe('toPaginationMeta', () => {
  it('computes totalPages by dividing total by limit', () => {
    expect(toPaginationMeta({ page: 2, limit: 10 }, 25)).toEqual({
      page: 2,
      limit: 10,
      total: 25,
      totalPages: 3,
    });
  });

  it('returns totalPages 0 when there are no results', () => {
    expect(toPaginationMeta({ page: 1, limit: 10 }, 0)).toEqual({
      page: 1,
      limit: 10,
      total: 0,
      totalPages: 0,
    });
  });
});

describe('buildOrderBy', () => {
  it('splits the sort string and appends an id tiebreaker in the same direction', () => {
    expect(buildOrderBy('name:asc', (field, direction) => ({ [field]: direction }))).toEqual([
      { name: 'asc' },
      { id: 'asc' },
    ]);
  });

  it('nests entries under a relation key when the mapper does so', () => {
    expect(
      buildOrderBy('updatedAt:desc', (field, direction) => ({ project: { [field]: direction } })),
    ).toEqual([{ project: { updatedAt: 'desc' } }, { project: { id: 'desc' } }]);
  });
});

describe('buildSearchWhere', () => {
  it('returns an empty object when search is absent', () => {
    expect(buildSearchWhere(undefined, (contains) => ({ name: contains }))).toEqual({});
  });

  it('builds a case-insensitive contains fragment when search is present', () => {
    expect(buildSearchWhere('apartment', (contains) => ({ name: contains }))).toEqual({
      name: { contains: 'apartment', mode: 'insensitive' },
    });
  });

  it('nests the fragment under a relation key when the mapper does so', () => {
    expect(buildSearchWhere('living', (contains) => ({ scan: { name: contains } }))).toEqual({
      scan: { name: { contains: 'living', mode: 'insensitive' } },
    });
  });
});
