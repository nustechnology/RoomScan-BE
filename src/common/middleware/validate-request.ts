import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

export interface RequestValidationSchemas {
  body?: ZodType;
  params?: ZodType;
  query?: ZodType;
}

export function validateRequest(schemas: RequestValidationSchemas): RequestHandler {
  return async (request, response, next) => {
    const validated: Record<string, unknown> = {};
    const sources = ['body', 'params', 'query'] as const;

    for (const source of sources) {
      const schema = schemas[source];

      if (schema === undefined) {
        continue;
      }

      const result = await schema.safeParseAsync(request[source]);

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
