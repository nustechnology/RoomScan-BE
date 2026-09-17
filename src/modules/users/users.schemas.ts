import { PublicUserIdSchema } from '../../common/schemas/public-user-id.js';
import { z } from '../../openapi/zod.js';

export const UpdateMeBodySchema = z
  .object({
    displayName: z.string().trim().min(1).max(100).nullable(),
  })
  .strict();

export const UserProfileResponseSchema = z.object({
  id: z.uuid(),
  publicUserId: PublicUserIdSchema,
  email: z.email().nullable(),
  displayName: z.string().nullable(),
  provider: z.literal('apple'),
});

export const GetMeResponseSchema = z.object({
  publicUserId: PublicUserIdSchema.openapi({
    description: 'Share this id so other users can invite you without knowing your email address',
  }),
  email: z.email().nullable(),
  displayName: z.string().nullable(),
});

export type UpdateMeBody = z.infer<typeof UpdateMeBodySchema>;
export type UserProfileResponse = z.infer<typeof UserProfileResponseSchema>;
export type GetMeResponse = z.infer<typeof GetMeResponseSchema>;
