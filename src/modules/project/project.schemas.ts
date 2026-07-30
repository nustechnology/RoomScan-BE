import { z } from '../../openapi/zod.js';

export const ProjectSyncStatusSchema = z
  .enum(['PENDING', 'SYNCING', 'SYNCED', 'FAILED', 'CONFLICT'])
  .nullable();

export const ProjectPermissionsSchema = z.object({
  role: z.enum(['OWNER', 'VIEWER']),
  canView: z.boolean(),
  canEdit: z.boolean(),
  canDelete: z.boolean(),
  canShare: z.boolean(),
  canCreateScan: z.boolean(),
});

export const ProjectResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  owner: z.object({
    id: z.uuid(),
    email: z.email().nullable(),
  }),
  scanCount: z.number().int().nonnegative(),
  sharedCount: z.number().int().nonnegative(),
  thumbnail: z.url().nullable(),
  syncStatus: ProjectSyncStatusSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  permissions: ProjectPermissionsSchema,
});

export const ProjectListResponseSchema = z.object({
  items: z.array(ProjectResponseSchema),
  pagination: z.object({
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }),
});

export const CreateProjectBodySchema = z
  .object({
    name: z.string().trim().min(1).max(50),
    description: z.string().max(500).nullable().default(null),
  })
  .strict();

export const UpdateProjectBodySchema = z
  .object({
    name: z.string().trim().min(1).max(50).optional(),
    description: z.string().max(500).nullable().optional(),
  })
  .strict()
  .refine((data) => data.name !== undefined || data.description !== undefined, {
    message: 'At least one field must be provided',
  });

export const ProjectIdParamSchema = z.object({
  projectId: z.uuid(),
});

export const ProjectSortSchema = z.enum([
  'updatedAt:desc',
  'updatedAt:asc',
  'createdAt:desc',
  'createdAt:asc',
  'name:asc',
  'name:desc',
]);

export const ListProjectsQuerySchema = z
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

export type ProjectResponse = z.infer<typeof ProjectResponseSchema>;
export type ProjectListResponse = z.infer<typeof ProjectListResponseSchema>;
export type CreateProjectBody = z.infer<typeof CreateProjectBodySchema>;
export type UpdateProjectBody = z.infer<typeof UpdateProjectBodySchema>;
export type ProjectIdParam = z.infer<typeof ProjectIdParamSchema>;
export type ListProjectsQuery = z.infer<typeof ListProjectsQuerySchema>;
