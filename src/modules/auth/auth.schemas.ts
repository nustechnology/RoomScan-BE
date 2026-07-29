import { z } from '../../openapi/zod.js';

export const AppleSignInRequestSchema = z
  .object({
    identityToken: z.string().trim().min(1).max(16_384),
    nonce: z.string().trim().min(1).max(512).optional(),
  })
  .strict();

export const AuthenticatedUserSchema = z.object({
  id: z.uuid(),
  email: z.email().nullable(),
  provider: z.literal('apple'),
});

export const AppleSignInResponseSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  user: AuthenticatedUserSchema,
});

export type AppleSignInRequest = z.infer<typeof AppleSignInRequestSchema>;
export type AppleSignInResponse = z.infer<typeof AppleSignInResponseSchema>;
