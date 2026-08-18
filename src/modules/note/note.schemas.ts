import { z } from '../../openapi/zod.js';

export const NoteColorSchema = z.enum([
  'YELLOW',
  'RED',
  'BLUE',
  'GREEN',
  'ORANGE',
  'PURPLE',
  'CYAN',
  'GRAY',
]);

export const Vector3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

export const NotePermissionsSchema = z.object({
  role: z.enum(['OWNER', 'VIEWER']),
  canView: z.boolean(),
  canEdit: z.boolean(),
  canDelete: z.boolean(),
});

export const NoteResponseSchema = z.object({
  id: z.uuid(),
  scanId: z.uuid(),
  title: z.string(),
  content: z.string(),
  color: NoteColorSchema,
  position: Vector3Schema,
  orientation: Vector3Schema.nullable(),
  modelVersion: z.string(),
  creator: z.object({
    id: z.uuid(),
    email: z.email().nullable(),
  }),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  permissions: NotePermissionsSchema,
});

export const NoteListResponseSchema = z.object({
  items: z.array(NoteResponseSchema),
  pagination: z.object({
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }),
});

export const CreateNoteBodySchema = z
  .object({
    title: z.string().trim().min(1).max(50),
    content: z.string().trim().min(1).max(2000),
    color: NoteColorSchema,
    position: Vector3Schema,
    orientation: Vector3Schema.nullable().optional(),
    modelVersion: z.string().trim().min(1).max(64),
  })
  .strict();

export const UpdateNoteBodySchema = z
  .object({
    title: z.string().trim().min(1).max(50).optional(),
    content: z.string().trim().min(1).max(2000).optional(),
    color: NoteColorSchema.optional(),
  })
  .strict()
  .refine(
    (data) => data.title !== undefined || data.content !== undefined || data.color !== undefined,
    {
      message: 'At least one field must be provided',
    },
  );

export const MoveNoteBodySchema = z
  .object({
    position: Vector3Schema,
    orientation: Vector3Schema.nullable().optional(),
    modelVersion: z.string().trim().min(1).max(64),
  })
  .strict();

export const NoteIdParamSchema = z.object({
  noteId: z.uuid(),
});

export const NoteSortSchema = z.enum([
  'createdAt:desc',
  'createdAt:asc',
  'updatedAt:desc',
  'updatedAt:asc',
]);

export const ListNotesQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    sort: NoteSortSchema.default('updatedAt:desc'),
  })
  .strict();

export type NoteResponse = z.infer<typeof NoteResponseSchema>;
export type NoteListResponse = z.infer<typeof NoteListResponseSchema>;
export type CreateNoteBody = z.infer<typeof CreateNoteBodySchema>;
export type UpdateNoteBody = z.infer<typeof UpdateNoteBodySchema>;
export type MoveNoteBody = z.infer<typeof MoveNoteBodySchema>;
export type NoteIdParam = z.infer<typeof NoteIdParamSchema>;
export type ListNotesQuery = z.infer<typeof ListNotesQuerySchema>;
