import { z } from '../../openapi/zod.js';

export const InvitationTokenParamSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Invitation token is malformed'),
});

export const InvitationIdParamSchema = z.object({
  invitationId: z.uuid(),
});

export const ShareRevokeParamsSchema = z.object({
  projectId: z.uuid(),
  userId: z.uuid(),
});

export const InvitationCreateBodySchema = z
  .object({
    recipientEmail: z.email(),
    expiresInSeconds: z.number().int().min(60).max(2_592_000).optional(),
  })
  .strict();

export const InvitationCreateResponseSchema = z.object({
  invitationId: z.uuid(),
  invitationUrl: z.url(),
  recipientEmail: z.email(),
  expiresAt: z.iso.datetime(),
  status: z.literal('PENDING'),
  sentAt: z.iso.datetime(),
});

export const InvitationResendResponseSchema = InvitationCreateResponseSchema;

export const InvitationPreviewResponseSchema = z.object({
  project: z.object({
    id: z.uuid(),
    name: z.string(),
    description: z.string().nullable(),
    thumbnail: z.url().nullable(),
  }),
  status: z.enum(['PENDING', 'EXPIRED', 'ACCEPTED', 'DECLINED', 'REVOKED']),
  recipientEmail: z.email(),
  sentAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  hasAccess: z.boolean().optional(),
});

export const InvitationAcceptResponseSchema = z.object({
  invitationId: z.uuid(),
  project: z.object({
    id: z.uuid(),
    name: z.string(),
    description: z.string().nullable(),
    thumbnail: z.url().nullable(),
    owner: z.object({
      id: z.uuid(),
      email: z.email().nullable(),
    }),
  }),
  access: z.object({
    role: z.literal('VIEWER'),
    status: z.literal('ACTIVE'),
    grantedAt: z.iso.datetime(),
  }),
});

export const InvitationDeclineResponseSchema = z.object({
  invitationId: z.uuid(),
  status: z.literal('DECLINED'),
  declinedAt: z.iso.datetime(),
});

export const InvitationRevokeResponseSchema = z.object({
  invitationId: z.uuid(),
  status: z.literal('REVOKED'),
  revokedAt: z.iso.datetime(),
});

export const SharesListResponseSchema = z.object({
  pendingInvitations: z.array(
    z.object({
      invitationId: z.uuid(),
      recipientEmail: z.email(),
      status: z.enum(['PENDING', 'EXPIRED']),
      sentAt: z.iso.datetime(),
      expiresAt: z.iso.datetime(),
    }),
  ),
  viewers: z.array(
    z.object({
      userId: z.uuid(),
      recipientUser: z.object({
        id: z.uuid(),
        email: z.email().nullable(),
      }),
      grantedAt: z.iso.datetime(),
    }),
  ),
});

export const ViewerRevokeResponseSchema = z.object({
  projectId: z.uuid(),
  userId: z.uuid(),
  revokedAt: z.iso.datetime(),
});

export type InvitationTokenParam = z.infer<typeof InvitationTokenParamSchema>;
export type InvitationIdParam = z.infer<typeof InvitationIdParamSchema>;
export type ShareRevokeParams = z.infer<typeof ShareRevokeParamsSchema>;
export type InvitationCreateBody = z.infer<typeof InvitationCreateBodySchema>;
export type InvitationCreateResponse = z.infer<typeof InvitationCreateResponseSchema>;
export type InvitationResendResponse = z.infer<typeof InvitationResendResponseSchema>;
export type InvitationPreviewResponse = z.infer<typeof InvitationPreviewResponseSchema>;
export type InvitationAcceptResponse = z.infer<typeof InvitationAcceptResponseSchema>;
export type InvitationDeclineResponse = z.infer<typeof InvitationDeclineResponseSchema>;
export type InvitationRevokeResponse = z.infer<typeof InvitationRevokeResponseSchema>;
export type SharesListResponse = z.infer<typeof SharesListResponseSchema>;
export type ViewerRevokeResponse = z.infer<typeof ViewerRevokeResponseSchema>;
