import { z } from '../../openapi/zod.js';

export const SyncResourceTypeSchema = z.enum([
  'PROJECT',
  'SCAN',
  'NOTE',
  'SCAN_ASSET',
  'PROJECT_ACCESS',
]);
export const SyncStatusSchema = z.enum(['PENDING', 'SYNCING', 'SYNCED', 'FAILED', 'CONFLICT']);

export const SyncChangesQuerySchema = z
  .object({
    since: z.string().trim().min(1).max(128).optional(),
    cursor: z.string().trim().min(1).max(4096).optional(),
    limit: z.coerce.number().int().positive().max(500).default(100),
  })
  .strict();

export const SyncStatusQuerySchema = z
  .object({
    projectId: z.uuid().optional(),
  })
  .strict();

const SyncChangeBaseSchema = z.object({
  resourceId: z.uuid(),
  operation: z.enum(['UPSERT', 'DELETE']),
  revision: z.number().int().positive(),
  syncStatus: SyncStatusSchema,
  changedAt: z.iso.datetime(),
  cursor: z.string().min(1),
  deletedAt: z.iso.datetime().nullable(),
});

const ProjectSyncDataSchema = z.object({
  id: z.uuid(),
  ownerId: z.uuid(),
  ownerEmail: z.email().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  lastSyncedAt: z.iso.datetime().nullable(),
});

const ScanSyncDataSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  createdById: z.uuid(),
  creatorEmail: z.email().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  thumbnail: z.string().nullable(),
  assetStatus: z.enum(['NONE', 'PENDING', 'UPLOADING', 'UPLOADED', 'FAILED']),
  modelVersion: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

const Vector3Schema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite(),
});

const NoteSyncDataSchema = z.object({
  id: z.uuid(),
  scanId: z.uuid(),
  createdById: z.uuid(),
  creatorEmail: z.email().nullable(),
  title: z.string(),
  content: z.string(),
  color: z.enum(['YELLOW', 'RED', 'BLUE', 'GREEN', 'ORANGE', 'PURPLE', 'CYAN', 'GRAY']),
  position: Vector3Schema,
  orientation: Vector3Schema.nullable(),
  modelVersion: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

const ScanAssetSyncDataSchema = z.object({
  id: z.uuid(),
  scanId: z.uuid(),
  assetType: z.enum(['MODEL', 'THUMBNAIL']),
  status: z.enum(['NONE', 'PENDING', 'UPLOADING', 'UPLOADED', 'FAILED']),
  contentType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  checksum: z.string().nullable(),
  modelVersion: z.string().nullable(),
  uploadedAt: z.iso.datetime().nullable(),
  uploadUrlExpiresAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

const ProjectAccessSyncDataSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  userId: z.uuid(),
  userEmail: z.email().nullable(),
  role: z.enum(['OWNER', 'VIEWER']),
  acceptedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const SyncChangeItemSchema = z.discriminatedUnion('resourceType', [
  SyncChangeBaseSchema.extend({
    resourceType: z.literal('PROJECT'),
    data: ProjectSyncDataSchema.nullable(),
  }),
  SyncChangeBaseSchema.extend({
    resourceType: z.literal('SCAN'),
    data: ScanSyncDataSchema.nullable(),
  }),
  SyncChangeBaseSchema.extend({
    resourceType: z.literal('NOTE'),
    data: NoteSyncDataSchema.nullable(),
  }),
  SyncChangeBaseSchema.extend({
    resourceType: z.literal('SCAN_ASSET'),
    data: ScanAssetSyncDataSchema.nullable(),
  }),
  SyncChangeBaseSchema.extend({
    resourceType: z.literal('PROJECT_ACCESS'),
    data: ProjectAccessSyncDataSchema.nullable(),
  }),
]);

export const SyncChangesResponseSchema = z.object({
  changes: z.array(SyncChangeItemSchema),
  nextCursor: z.string().min(1),
});

export const SyncStatusItemSchema = z.object({
  projectId: z.uuid(),
  syncStatus: SyncStatusSchema,
  pendingCount: z.number().int().nonnegative(),
  syncingCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  conflictCount: z.number().int().nonnegative(),
  lastSyncedAt: z.iso.datetime().nullable(),
  requiredAssetsUploaded: z.boolean(),
});

export const SyncStatusResponseSchema = z.object({
  items: z.array(SyncStatusItemSchema),
});

export type SyncChangesQuery = z.infer<typeof SyncChangesQuerySchema>;
export type SyncStatusQuery = z.infer<typeof SyncStatusQuerySchema>;
