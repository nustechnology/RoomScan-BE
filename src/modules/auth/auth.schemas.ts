import { z } from '../../openapi/zod.js';

export const AppleSignInRequestSchema = z
  .object({
    identityToken: z
      .string()
      .trim()
      .min(1)
      .max(16_384)
      .openapi({ description: 'Apple identity token JWT' }),
    nonce: z.string().trim().min(1).max(512).optional().openapi({
      description:
        "Raw nonce whose SHA-256 hex digest is stored in the identity token's nonce claim; required when that claim is present",
    }),
  })
  .strict();

export const AuthenticatedUserSchema = z.object({
  id: z.uuid(),
  email: z.email().nullable(),
  displayName: z.string().nullable(),
  provider: z.literal('apple'),
});

export const AppleSignInResponseSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  user: AuthenticatedUserSchema,
});

export type AppleSignInRequest = z.infer<typeof AppleSignInRequestSchema>;
export type AppleSignInResponse = z.infer<typeof AppleSignInResponseSchema>;

export const RefreshTokenRequestSchema = z
  .object({
    refreshToken: z.string().trim().min(1).max(16_384),
  })
  .strict();

export const RefreshTokenResponseSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
});

export type RefreshTokenRequest = z.infer<typeof RefreshTokenRequestSchema>;
export type RefreshTokenResponse = z.infer<typeof RefreshTokenResponseSchema>;
