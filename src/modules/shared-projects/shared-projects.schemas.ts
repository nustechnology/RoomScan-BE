import { z } from '../../openapi/zod.js';
import {
  ProjectIdParamSchema,
  ProjectPermissionsSchema,
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
  }),
  scanCount: z.number().int().nonnegative(),
  thumbnail: z.url().nullable(),
  updatedAt: z.iso.datetime(),
  status: SharedProjectStatusSchema,
  permissions: ProjectPermissionsSchema,
});

export const SharedProjectListResponseSchema = z.object({
  items: z.array(SharedProjectResponseSchema),
  pagination: z.object({
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }),
});

export const SharedProjectRemoveResponseSchema = z.object({
  projectId: z.uuid(),
  removedAt: z.iso.datetime(),
});

export const ListSharedProjectsQuerySchema = z
  .object({
    search: z
      .string()
      .trim()
      .max(50)
      .optional()
      .transform((value) => (value === '' ? undefined : value)),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(5),
    sort: ProjectSortSchema.default('updatedAt:desc'),
  })
  .strict();

export const SharedProjectIdParamSchema = ProjectIdParamSchema;

export type SharedProjectResponse = z.infer<typeof SharedProjectResponseSchema>;
export type SharedProjectListResponse = z.infer<typeof SharedProjectListResponseSchema>;
export type SharedProjectRemoveResponse = z.infer<typeof SharedProjectRemoveResponseSchema>;
export type ListSharedProjectsQuery = z.infer<typeof ListSharedProjectsQuerySchema>;
