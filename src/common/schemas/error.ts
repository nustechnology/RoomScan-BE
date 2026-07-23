import { z } from '../../openapi/zod.js';

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
  requestId: z.string(),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
