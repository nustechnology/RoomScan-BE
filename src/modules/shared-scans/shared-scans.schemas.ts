import { z } from '../../openapi/zod.js';
import {
  paginatedResponseSchema,
  paginationQuerySchema,
  searchQuerySchema,
} from '../../common/pagination/pagination.js';
import { ScanIdParamSchema, ScanPermissionsSchema, ScanSortSchema } from '../scan/scan.schemas.js';

export const SharedScanStatusSchema = z.enum([
  'ACTIVE',
  'REVOKED',
  'SCAN_DELETED',
  'TEMPORARILY_UNAVAILABLE',
]);

export const SharedScanResponseSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  thumbnail: z.url().nullable(),
  creator: z.object({
    id: z.uuid(),
    email: z.email().nullable(),
    displayName: z.string().nullable(),
  }),
  noteCount: z.number().int().nonnegative(),
  assetStatus: z.enum(['NONE', 'PENDING', 'UPLOADING', 'UPLOADED', 'FAILED']),
  syncStatus: z.enum(['PENDING', 'SYNCING', 'SYNCED', 'FAILED', 'CONFLICT']),
  modelVersion: z.number().int().positive(),
  updatedAt: z.iso.datetime(),
  status: SharedScanStatusSchema,
  permissions: ScanPermissionsSchema,
});

export const SharedScanListResponseSchema = paginatedResponseSchema(SharedScanResponseSchema);

export const SharedScanRemoveResponseSchema = z.object({
  scanId: z.uuid(),
  removedAt: z.iso.datetime(),
});

export const ListSharedScansQuerySchema = z
  .object({
    search: searchQuerySchema(),
    ...paginationQuerySchema(5).shape,
    sort: ScanSortSchema.default('updatedAt:desc'),
  })
  .strict();

export const SharedScanIdParamSchema = ScanIdParamSchema;

export type SharedScanResponse = z.infer<typeof SharedScanResponseSchema>;
export type SharedScanListResponse = z.infer<typeof SharedScanListResponseSchema>;
export type SharedScanRemoveResponse = z.infer<typeof SharedScanRemoveResponseSchema>;
export type ListSharedScansQuery = z.infer<typeof ListSharedScansQuerySchema>;
