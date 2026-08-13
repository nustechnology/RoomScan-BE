import { z } from '../../openapi/zod.js';

export const IdempotencyKeyHeaderSchema = z
  .object({
    'Idempotency-Key': z.string().trim().min(1).max(128).optional(),
  })
  .strict();

export const IfMatchHeaderSchema = z
  .object({
    'If-Match': z.string().trim().min(1).optional(),
  })
  .strict();
