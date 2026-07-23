import { APP_NAME } from '../../config/constants.js';
import { z } from '../../openapi/zod.js';

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal(APP_NAME),
  version: z.string(),
  timestamp: z.iso.datetime(),
});

export const ReadinessResponseSchema = HealthResponseSchema.extend({
  database: z.literal('up'),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type ReadinessResponse = z.infer<typeof ReadinessResponseSchema>;
