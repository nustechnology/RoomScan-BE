import { z } from '../../openapi/zod.js';
import {
  paginatedResponseSchema,
  paginationQuerySchema,
  searchQuerySchema,
} from '../../common/pagination/pagination.js';
import {
  ProjectIdParamSchema,
  ProjectPermissionsSchema,
  ProjectScanSummarySchema,
  ProjectSortSchema,
} from '../project/project.schemas.js';

export const SharedProjectStatusSchema = z.enum([
  'ACTIVE',
  'REVOKED',
  'PROJECT_DELETED',
  'TEMPORARILY_UNAVAILABLE',
]);

export const SharedProjectResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  owner: z.object({
    id: z.uuid(),
    email: z.email().nullable(),
    displayName: z.string().nullable(),
  }),
  scanCount: z.number().int().nonnegative(),
  thumbnail: z.url().nullable(),
  updatedAt: z.iso.datetime(),
  status: SharedProjectStatusSchema,
  permissions: ProjectPermissionsSchema,
});

export const SharedProjectDetailResponseSchema = SharedProjectResponseSchema.extend({
  scans: z.array(ProjectScanSummarySchema),
});

export const SharedProjectListResponseSchema = paginatedResponseSchema(SharedProjectResponseSchema);

export const SharedProjectRemoveResponseSchema = z.object({
  projectId: z.uuid(),
  removedAt: z.iso.datetime(),
});

export const ListSharedProjectsQuerySchema = z
  .object({
    search: searchQuerySchema(),
    ...paginationQuerySchema(5).shape,
    sort: ProjectSortSchema.default('updatedAt:desc'),
  })
  .strict();

export const SharedProjectIdParamSchema = ProjectIdParamSchema;

export type SharedProjectResponse = z.infer<typeof SharedProjectResponseSchema>;
export type SharedProjectDetailResponse = z.infer<typeof SharedProjectDetailResponseSchema>;
export type SharedProjectListResponse = z.infer<typeof SharedProjectListResponseSchema>;
export type SharedProjectRemoveResponse = z.infer<typeof SharedProjectRemoveResponseSchema>;
export type ListSharedProjectsQuery = z.infer<typeof ListSharedProjectsQuerySchema>;
