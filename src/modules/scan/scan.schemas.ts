import { z } from '../../openapi/zod.js';
import { MODEL_CONTENT_TYPES, THUMBNAIL_CONTENT_TYPES } from '../scan-asset/scan-asset.types.js';

export const ScanSyncStatusSchema = z.enum(['PENDING', 'SYNCING', 'SYNCED', 'FAILED', 'CONFLICT']);

export const ScanAssetStatusSchema = z.enum(['NONE', 'PENDING', 'UPLOADING', 'UPLOADED', 'FAILED']);

export const ScanPermissionsSchema = z.object({
  role: z.enum(['OWNER', 'VIEWER']),
  canView: z.boolean(),
  canEdit: z.boolean(),
  canDelete: z.boolean(),
});

export const ScanUploadUrlSchema = z.object({
  uploadSessionId: z.uuid(),
  assetId: z.uuid(),
  uploadUrl: z.url(),
  uploadUrlExpiresAt: z.iso.datetime(),
});

export const ScanResponseSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  thumbnail: z.url().nullable(),
  creator: z.object({
    id: z.uuid(),
    email: z.email().nullable(),
  }),
  noteCount: z.number().int().nonnegative(),
  assetStatus: ScanAssetStatusSchema,
  syncStatus: ScanSyncStatusSchema,
  modelVersion: z.number().int().positive(),
  revision: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  permissions: ScanPermissionsSchema,
});

export const ScanListResponseSchema = z.object({
  items: z.array(ScanResponseSchema),
  pagination: z.object({
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }),
});

export const ThumbnailUploadDescriptorSchema = z
  .object({
    contentType: z.enum(THUMBNAIL_CONTENT_TYPES),
    sizeBytes: z.number().int().positive(),
    checksum: z.string().trim().min(1).max(128).optional(),
  })
  .strict();

export const ScanFileUploadDescriptorSchema = z
  .object({
    contentType: z.enum(MODEL_CONTENT_TYPES),
    sizeBytes: z.number().int().positive(),
    checksum: z.string().trim().min(1).max(128),
    modelVersion: z.string().trim().min(1).max(64),
  })
  .strict();

export const CreateScanBodySchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().max(500).nullable().default(null),
    clientMutationId: z.string().trim().min(1).max(128).optional(),
    thumbnail: ThumbnailUploadDescriptorSchema.optional(),
    scanFile: ScanFileUploadDescriptorSchema.optional(),
  })
  .strict();

export const CreateScanResponseSchema = ScanResponseSchema.extend({
  uploads: z
    .object({
      thumbnail: ScanUploadUrlSchema.optional(),
      scanFile: ScanUploadUrlSchema.optional(),
    })
    .optional(),
});

export const UpdateScanBodySchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().max(500).nullable().optional(),
  })
  .strict()
  .refine((data) => data.name !== undefined || data.description !== undefined, {
    message: 'At least one field must be provided',
  });

export const ScanIdParamSchema = z.object({
  scanId: z.uuid(),
});

export const ScanSortSchema = z.enum([
  'createdAt:desc',
  'createdAt:asc',
  'updatedAt:desc',
  'updatedAt:asc',
  'name:asc',
  'name:desc',
]);

export const ListScansQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    sort: ScanSortSchema.default('createdAt:desc'),
  })
  .strict();

export type ScanResponse = z.infer<typeof ScanResponseSchema>;
export type ScanListResponse = z.infer<typeof ScanListResponseSchema>;
export type ScanUploadUrl = z.infer<typeof ScanUploadUrlSchema>;
export type CreateScanBody = z.infer<typeof CreateScanBodySchema>;
export type CreateScanResponse = z.infer<typeof CreateScanResponseSchema>;
export type ThumbnailUploadDescriptor = z.infer<typeof ThumbnailUploadDescriptorSchema>;
export type ScanFileUploadDescriptor = z.infer<typeof ScanFileUploadDescriptorSchema>;
export type UpdateScanBody = z.infer<typeof UpdateScanBodySchema>;
export type ScanIdParam = z.infer<typeof ScanIdParamSchema>;
export type ListScansQuery = z.infer<typeof ListScansQuerySchema>;
