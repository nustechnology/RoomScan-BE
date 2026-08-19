import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

export interface RequestValidationSchemas {
  body?: ZodType;
  params?: ZodType;
  query?: ZodType;
  headers?: ZodType;
}

function normalizeHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string | string[] | undefined> {
  const normalized: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    const normalizedKey = key
      .split('-')
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join('-');
    normalized[normalizedKey] = value;
  }
  return normalized;
}

export function validateRequest(schemas: RequestValidationSchemas): RequestHandler {
  return async (request, response, next) => {
    const validated: Record<string, unknown> = {};
    const sources = ['body', 'params', 'query', 'headers'] as const;

    for (const source of sources) {
      const schema = schemas[source];

      if (schema === undefined) {
        continue;
      }

      const input: unknown =
        source === 'headers' ? normalizeHeaders(request.headers) : request[source];

      const result = await schema.safeParseAsync(input);

      if (!result.success) {
        next(result.error);
        return;
      }

      validated[source] = result.data;
    }

    response.locals.validated = validated;
    next();
  };
}
