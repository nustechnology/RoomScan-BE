import { z } from '../../openapi/zod.js';

export const IdempotencyKeyHeaderSchema = z.object({
  'Idempotency-Key': z
    .string()
    .trim()
    .min(1)
    .max(128)
    .refine(
      (value) =>
        ![...value].some((character) => {
          const codePoint = character.codePointAt(0);
          return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
        }),
      'Idempotency-Key must not contain control characters',
    )
    .openapi({
      description:
        'Required retry key scoped to the authenticated user, operation, and concrete parent resource. Reuse with the same validated payload replays the original response; reuse with a different payload returns 409.',
      example: 'mobile-mutation-018f2c1a',
    }),
});

export const IfMatchHeaderSchema = z.object({
  'If-Match': z
    .string()
    .regex(/^"[1-9]\d*"$/)
    .openapi({
      description:
        'Required strong ETag containing the last revision read by the client, for example "3".',
      example: '"3"',
    }),
});
