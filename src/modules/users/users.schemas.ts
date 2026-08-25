import { z } from '../../openapi/zod.js';

export const UpdateMeBodySchema = z
  .object({
    displayName: z.string().trim().min(1).max(100).nullable(),
  })
  .strict();

export const UserProfileResponseSchema = z.object({
  id: z.uuid(),
  email: z.email().nullable(),
  displayName: z.string().nullable(),
  provider: z.literal('apple'),
});

export const GetMeResponseSchema = z.object({
  email: z.email().nullable(),
  displayName: z.string().nullable(),
});

export type UpdateMeBody = z.infer<typeof UpdateMeBodySchema>;
export type UserProfileResponse = z.infer<typeof UserProfileResponseSchema>;
export type GetMeResponse = z.infer<typeof GetMeResponseSchema>;
