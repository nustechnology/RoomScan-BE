import { z } from '../../openapi/zod.js';
import { MODEL_CONTENT_TYPES, THUMBNAIL_CONTENT_TYPES } from './scan-asset.types.js';

const modelUploadBranchSchema = z
  .object({
    assetType: z.literal('MODEL'),
    contentType: z.enum(MODEL_CONTENT_TYPES),
    sizeBytes: z.number().int().positive(),
    checksum: z.string().trim().min(1).max(128),
    modelVersion: z.string().trim().min(1).max(64),
    idempotencyKey: z.string().trim().min(1).max(128).optional(),
  })
  .strict();

const thumbnailUploadBranchSchema = z
  .object({
    assetType: z.literal('THUMBNAIL'),
    contentType: z.enum(THUMBNAIL_CONTENT_TYPES),
    sizeBytes: z.number().int().positive(),
    checksum: z.string().trim().min(1).max(128).optional(),
    modelVersion: z.string().trim().min(1).max(64).optional(),
    idempotencyKey: z.string().trim().min(1).max(128).optional(),
  })
  .strict();

export const CreateUploadSessionBodySchema = z.discriminatedUnion('assetType', [
  modelUploadBranchSchema,
  thumbnailUploadBranchSchema,
]);

export const CompleteUploadBodySchema = z
  .object({
    checksum: z.string().trim().min(1).max(128).optional(),
    sizeBytes: z.number().int().positive().optional(),
  })
  .strict();

export const FailUploadBodySchema = z
  .object({
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

export const AssetTypeParamSchema = z.object({
  assetType: z.enum(['MODEL', 'THUMBNAIL']),
});

export const UploadSessionIdParamSchema = z.object({
  uploadSessionId: z.uuid(),
});

export const ScanAssetMetadataSchema = z.object({
  assetId: z.uuid(),
  scanId: z.uuid(),
  assetType: z.enum(['MODEL', 'THUMBNAIL']),
  status: z.enum(['PENDING', 'UPLOADING', 'UPLOADED', 'FAILED']),
  contentType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  checksum: z.string().nullable(),
  modelVersion: z.string().nullable(),
  revision: z.number().int().positive().default(1),
  uploadedAt: z.iso.datetime().nullable(),
  uploadSessionId: z.uuid(),
  uploadUrlExpiresAt: z.iso.datetime().nullable(),
  downloadUrlExpiresAt: z.iso.datetime().nullable(),
});

export const CreateUploadSessionResponseSchema = z.object({
  uploadSessionId: z.uuid(),
  assetId: z.uuid(),
  assetType: z.enum(['MODEL', 'THUMBNAIL']),
  status: z.enum(['PENDING', 'UPLOADING', 'UPLOADED', 'FAILED']),
  uploadUrl: z.url(),
  uploadUrlExpiresAt: z.iso.datetime(),
  revision: z.number().int().positive().default(1),
});

export const AssetMetadataResponseSchema = ScanAssetMetadataSchema;

export const ListAssetsResponseSchema = z.object({
  items: z.array(ScanAssetMetadataSchema),
});

export const DownloadUrlResponseSchema = z.object({
  downloadUrl: z.url(),
  downloadUrlExpiresAt: z.iso.datetime(),
  asset: ScanAssetMetadataSchema,
});

export type CreateUploadSessionBody = z.infer<typeof CreateUploadSessionBodySchema>;
export type CompleteUploadBody = z.infer<typeof CompleteUploadBodySchema>;
export type FailUploadBody = z.infer<typeof FailUploadBodySchema>;
export type AssetTypeParam = z.infer<typeof AssetTypeParamSchema>;
export type UploadSessionIdParam = z.infer<typeof UploadSessionIdParamSchema>;
export type ScanAssetMetadata = z.infer<typeof ScanAssetMetadataSchema>;
export type CreateUploadSessionResponse = z.infer<typeof CreateUploadSessionResponseSchema>;
export type ListAssetsResponse = z.infer<typeof ListAssetsResponseSchema>;
export type DownloadUrlResponse = z.infer<typeof DownloadUrlResponseSchema>;
