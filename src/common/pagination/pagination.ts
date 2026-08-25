import { z } from '../../openapi/zod.js';

export type SortDirection = 'asc' | 'desc';

export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export function paginationQuerySchema(defaultLimit: number) {
  return z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(defaultLimit),
  });
}

export function searchQuerySchema() {
  return z
    .string()
    .trim()
    .max(50)
    .optional()
    .transform((value) => (value === '' ? undefined : value));
}

export function paginatedResponseSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    pagination: z.object({
      page: z.number().int().positive(),
      limit: z.number().int().positive(),
      total: z.number().int().nonnegative(),
      totalPages: z.number().int().nonnegative(),
    }),
  });
}

export function toSkipTake({ page, limit }: PaginationParams): { skip: number; take: number } {
  return { skip: (page - 1) * limit, take: limit };
}

export function toPaginationMeta({ page, limit }: PaginationParams, total: number): PaginationMeta {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}

export function parseSort(sort: string): { field: string; direction: SortDirection } {
  const [field, direction] = sort.split(':') as [string, SortDirection];
  return { field, direction };
}

/**
 * Builds a two-entry Prisma `orderBy` array from a combined `"field:direction"`
 * sort string, with a stable `id` tiebreaker in the same direction. `toEntry`
 * shapes each entry (e.g. nesting under a relation key) and is called once for
 * the sort field and once for the `id` tiebreaker.
 */
export function buildOrderBy<TOrderBy>(
  sort: string,
  toEntry: (field: string, direction: SortDirection) => TOrderBy,
): TOrderBy[] {
  const { field, direction } = parseSort(sort);
  return [toEntry(field, direction), toEntry('id', direction)];
}

/**
 * Builds a case-insensitive `contains` search where-clause fragment, or `{}`
 * when `search` is absent. `toWhere` shapes the fragment (e.g. nesting under a
 * relation key) so it can be spread directly into a Prisma `where` object.
 */
export function buildSearchWhere<TWhere>(
  search: string | undefined,
  toWhere: (contains: { contains: string; mode: 'insensitive' }) => TWhere,
): TWhere | Record<string, never> {
  if (search === undefined) {
    return {};
  }
  return toWhere({ contains: search, mode: 'insensitive' });
}
