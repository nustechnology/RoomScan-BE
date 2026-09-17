import {
  paginatedResponseSchema,
  paginationQuerySchema,
} from '../../common/pagination/pagination.js';
import {
  PublicUserIdInputSchema,
  PublicUserIdSchema,
} from '../../common/schemas/public-user-id.js';
import { z } from '../../openapi/zod.js';

const INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Preview, accept and decline address an invitation either by its raw link token
 * or, for an invitation the caller found in their own inbox, by its id. The two
 * forms cannot be confused: a token is 43 base64url characters, an id is a UUID.
 */
export const InvitationTokenParamSchema = z.object({
  reference: z
    .string()
    .refine(
      (value) => INVITATION_TOKEN_PATTERN.test(value) || UUID_PATTERN.test(value),
      'Invitation reference is malformed',
    )
    .openapi({ description: 'Invitation link token, or the id of an invitation addressed to you' }),
});

export const InvitationIdParamSchema = z.object({
  invitationId: z.uuid(),
});

export const ProjectShareLinkIdParamSchema = z.object({
  projectId: z.uuid(),
  shareLinkId: z.uuid(),
});

export const ScanShareLinkIdParamSchema = z.object({
  scanId: z.uuid(),
  shareLinkId: z.uuid(),
});

export const ShareRevokeParamsSchema = z.object({
  projectId: z.uuid(),
  userId: z.uuid(),
});

export const ScanShareRevokeParamsSchema = z.object({
  scanId: z.uuid(),
  userId: z.uuid(),
});

/**
 * An invitation is addressed to exactly one recipient: a public user id (binds
 * the invitation to that account) or an email address (bearer-style, and the
 * only option for someone who has not signed up yet).
 */
export const InvitationCreateBodySchema = z
  .object({
    recipientEmail: z.email().optional(),
    recipientPublicUserId: PublicUserIdInputSchema.optional(),
    expiresInSeconds: z.number().int().min(60).max(2_592_000).optional(),
  })
  .strict()
  .refine(
    (body) => (body.recipientEmail === undefined) !== (body.recipientPublicUserId === undefined),
    { message: 'Provide exactly one of recipientEmail or recipientPublicUserId' },
  );

export const InvitationCreateResponseSchema = z.object({
  invitationId: z.uuid(),
  invitationUrl: z.url(),
  recipientEmail: z.email().nullable(),
  recipientPublicUserId: PublicUserIdSchema.nullable(),
  expiresAt: z.iso.datetime(),
  status: z.literal('PENDING'),
  sentAt: z.iso.datetime(),
});

export const InvitationResendResponseSchema = InvitationCreateResponseSchema;

export const ShareScopeSchema = z.enum(['project', 'scan']);

const ProjectPreviewSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  thumbnail: z.url().nullable(),
  owner: z.object({
    id: z.uuid(),
    email: z.email().nullable(),
    displayName: z.string().nullable(),
  }),
  scanCount: z.number().int().nonnegative(),
});

const ProjectDetailSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  thumbnail: z.url().nullable(),
  owner: z.object({
    id: z.uuid(),
    email: z.email().nullable(),
    displayName: z.string().nullable(),
  }),
});

const ScanPreviewSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  thumbnail: z.url().nullable(),
  noteCount: z.number().int().nonnegative(),
  creator: z.object({
    id: z.uuid(),
    email: z.email().nullable(),
    displayName: z.string().nullable(),
  }),
});

const ScanDetailSchema = ScanPreviewSchema.extend({
  ownerId: z.uuid(),
});

const InvitationPreviewLiteralSchema = z.object({
  type: z.literal('invitation'),
  scope: ShareScopeSchema,
  project: ProjectPreviewSchema.nullable(),
  scan: ScanPreviewSchema.nullable(),
  status: z.enum(['PENDING', 'EXPIRED', 'ACCEPTED', 'DECLINED']),
  recipientEmail: z.email().nullable(),
  recipientPublicUserId: PublicUserIdSchema.nullable(),
  sentAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  hasAccess: z.boolean().optional(),
});

const ShareLinkPreviewLiteralSchema = z.object({
  type: z.literal('share-link'),
  scope: ShareScopeSchema,
  project: ProjectPreviewSchema.nullable(),
  scan: ScanPreviewSchema.nullable(),
  status: z.enum(['ACTIVE', 'EXPIRED']),
  expiresAt: z.iso.datetime(),
  hasAccess: z.boolean().optional(),
});

export const InvitationPreviewResponseSchema = z.discriminatedUnion('type', [
  InvitationPreviewLiteralSchema,
  ShareLinkPreviewLiteralSchema,
]);

const InvitationAcceptLiteralSchema = z.object({
  type: z.literal('invitation'),
  invitationId: z.uuid(),
  scope: ShareScopeSchema,
  project: ProjectDetailSchema.nullable(),
  scan: ScanDetailSchema.nullable(),
  access: z.object({
    role: z.literal('VIEWER'),
    status: z.literal('ACTIVE'),
    grantedAt: z.iso.datetime(),
  }),
});

const ShareLinkAcceptLiteralSchema = z.object({
  type: z.literal('share-link'),
  shareLinkId: z.uuid(),
  scope: ShareScopeSchema,
  project: ProjectDetailSchema.nullable(),
  scan: ScanDetailSchema.nullable(),
  access: z.object({
    role: z.literal('VIEWER'),
    status: z.literal('ACTIVE'),
    grantedAt: z.iso.datetime(),
  }),
});

export const InvitationAcceptResponseSchema = z.discriminatedUnion('type', [
  InvitationAcceptLiteralSchema,
  ShareLinkAcceptLiteralSchema,
]);

export const ReceivedInvitationSchema = z.object({
  invitationId: z.uuid(),
  scope: ShareScopeSchema,
  project: ProjectPreviewSchema.nullable(),
  scan: ScanPreviewSchema.nullable(),
  status: z.enum(['PENDING', 'EXPIRED', 'ACCEPTED', 'DECLINED', 'REVOKED']),
  invitedBy: z
    .object({
      id: z.uuid(),
      email: z.email().nullable(),
      displayName: z.string().nullable(),
    })
    .nullable(),
  sentAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});

export const ReceivedInvitationsResponseSchema = paginatedResponseSchema(ReceivedInvitationSchema);

export const ListReceivedInvitationsQuerySchema = z
  .object({ ...paginationQuerySchema(20).shape })
  .strict();

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
      recipientEmail: z.email().nullable(),
      recipientPublicUserId: PublicUserIdSchema.nullable(),
      recipientDisplayName: z.string().nullable(),
      status: z.enum(['PENDING', 'EXPIRED']),
      sentAt: z.iso.datetime(),
      expiresAt: z.iso.datetime(),
    }),
  ),
  viewers: z.array(
    z.object({
      userId: z.uuid(),
      revision: z.number().int().positive().optional(),
      recipientUser: z.object({
        id: z.uuid(),
        email: z.email().nullable(),
        displayName: z.string().nullable(),
      }),
      grantedAt: z.iso.datetime(),
    }),
  ),
});

export const ScanSharesListResponseSchema = SharesListResponseSchema;

export const ViewerRevokeResponseSchema = z.object({
  projectId: z.uuid(),
  userId: z.uuid(),
  revision: z.number().int().positive(),
  revokedAt: z.iso.datetime(),
});

export const ScanViewerRevokeResponseSchema = z.object({
  scanId: z.uuid(),
  userId: z.uuid(),
  revokedAt: z.iso.datetime(),
});

export const ShareLinkCreateResponseSchema = z.object({
  shareLinkId: z.uuid(),
  shareLinkUrl: z.url(),
  scope: ShareScopeSchema,
  expiresAt: z.iso.datetime(),
});

export const ShareLinkListResponseSchema = z.object({
  items: z.array(
    z.object({
      shareLinkId: z.uuid(),
      status: z.enum(['ACTIVE', 'EXPIRED', 'REVOKED']),
      expiresAt: z.iso.datetime(),
      createdAt: z.iso.datetime(),
    }),
  ),
});

export const ShareLinkRevokeResponseSchema = z.object({
  shareLinkId: z.uuid(),
  status: z.literal('REVOKED'),
  revokedAt: z.iso.datetime(),
});

export type InvitationTokenParam = z.infer<typeof InvitationTokenParamSchema>;
export type InvitationIdParam = z.infer<typeof InvitationIdParamSchema>;
export type ProjectShareLinkIdParam = z.infer<typeof ProjectShareLinkIdParamSchema>;
export type ScanShareLinkIdParam = z.infer<typeof ScanShareLinkIdParamSchema>;
export type ShareRevokeParams = z.infer<typeof ShareRevokeParamsSchema>;
export type ScanShareRevokeParams = z.infer<typeof ScanShareRevokeParamsSchema>;
export type InvitationCreateBody = z.infer<typeof InvitationCreateBodySchema>;
export type InvitationCreateResponse = z.infer<typeof InvitationCreateResponseSchema>;
export type InvitationResendResponse = z.infer<typeof InvitationResendResponseSchema>;
export type InvitationPreviewResponse = z.infer<typeof InvitationPreviewResponseSchema>;
export type InvitationAcceptResponse = z.infer<typeof InvitationAcceptResponseSchema>;
export type InvitationDeclineResponse = z.infer<typeof InvitationDeclineResponseSchema>;
export type InvitationRevokeResponse = z.infer<typeof InvitationRevokeResponseSchema>;
export type ReceivedInvitationsResponse = z.infer<typeof ReceivedInvitationsResponseSchema>;
export type ListReceivedInvitationsQuery = z.infer<typeof ListReceivedInvitationsQuerySchema>;
export type SharesListResponse = z.infer<typeof SharesListResponseSchema>;
export type ViewerRevokeResponse = z.infer<typeof ViewerRevokeResponseSchema>;
export type ShareLinkCreateResponse = z.infer<typeof ShareLinkCreateResponseSchema>;
export type ShareLinkListResponse = z.infer<typeof ShareLinkListResponseSchema>;
export type ShareLinkRevokeResponse = z.infer<typeof ShareLinkRevokeResponseSchema>;
