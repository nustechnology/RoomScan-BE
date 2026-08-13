import { z } from '../../openapi/zod.js';

export const SyncResourceTypeSchema = z.enum(['project', 'scan', 'note']);
export const SyncOperationSchema = z.enum(['CREATE', 'UPDATE', 'DELETE']);
export const SyncStatusSchema = z.enum(['PENDING', 'SYNCING', 'SYNCED', 'FAILED', 'CONFLICT']);

export const SyncChangesQuerySchema = z
  .object({
    since: z.iso.datetime().optional(),
    cursor: z.string().trim().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict()
  .refine((data) => data.since === undefined || data.cursor === undefined, {
    message: 'Provide either since or cursor, not both',
  });

export const SyncChangeSchema = z.object({
  resourceType: SyncResourceTypeSchema,
  resourceId: z.uuid(),
  operation: SyncOperationSchema,
  revision: z.number().int().positive(),
  syncStatus: SyncStatusSchema.nullable(),
  changedAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
  cursor: z.string(),
});

export const SyncChangesResponseSchema = z.object({
  changes: z.array(SyncChangeSchema),
  nextCursor: z.string().nullable(),
});

export const SyncStatusQuerySchema = z
  .object({
    projectId: z.uuid().optional(),
  })
  .strict();

export const SyncProjectStatusSchema = z.object({
  projectId: z.uuid(),
  syncStatus: SyncStatusSchema,
  pendingCount: z.number().int().nonnegative(),
  syncingCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  conflictCount: z.number().int().nonnegative(),
  lastSyncedAt: z.iso.datetime().nullable(),
  requiredAssetsUploaded: z.boolean(),
});

export const SyncStatusListResponseSchema = z.object({
  items: z.array(SyncProjectStatusSchema),
});

export type SyncChangesQuery = z.infer<typeof SyncChangesQuerySchema>;
export type SyncChange = z.infer<typeof SyncChangeSchema>;
export type SyncChangesResponse = z.infer<typeof SyncChangesResponseSchema>;
export type SyncStatusQuery = z.infer<typeof SyncStatusQuerySchema>;
export type SyncProjectStatus = z.infer<typeof SyncProjectStatusSchema>;
export type SyncStatusListResponse = z.infer<typeof SyncStatusListResponseSchema>;
