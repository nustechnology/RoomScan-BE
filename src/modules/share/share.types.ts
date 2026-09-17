import type {
  IdempotencyContext,
  IdempotencyResult,
} from '../../common/idempotency/idempotency.types.js';
import type { PaginationMeta, PaginationParams } from '../../common/pagination/pagination.js';

export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'REVOKED';
export type InvitationViewStatus = 'PENDING' | 'EXPIRED' | 'ACCEPTED' | 'DECLINED' | 'REVOKED';
export type ShareScope = 'project' | 'scan';
export type ShareLinkViewStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED';

export interface ShareUserSummary {
  id: string;
  email: string | null;
  displayName: string | null;
}

/** A user resolved from the public id an Owner typed when addressing an invitation. */
export interface ShareRecipientUser {
  id: string;
  publicUserId: string;
  email: string | null;
  displayName: string | null;
}

export interface ShareProjectSummary {
  id: string;
  name: string;
  description: string | null;
  thumbnail: string | null;
  owner: ShareUserSummary;
  scanCount: number;
}

export interface ShareScanSummary {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  thumbnail: string | null;
  noteCount: number;
  creator: ShareUserSummary;
  ownerId: string;
}

export interface ShareScanPreview {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  thumbnail: string | null;
  noteCount: number;
  creator: ShareUserSummary;
}

export interface ShareProjectPreview {
  id: string;
  name: string;
  description: string | null;
  thumbnail: string | null;
  owner: ShareUserSummary;
  scanCount: number;
}

export interface InvitationRecord {
  id: string;
  projectId: string | null;
  scanId: string | null;
  createdById: string;
  recipientEmail: string | null;
  recipientUserId: string | null;
  tokenHash: string;
  status: InvitationStatus;
  expiresAt: Date;
  sentAt: Date;
  acceptedAt: Date | null;
  acceptedByUserId: string | null;
  declinedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InvitationWithEntity {
  invitation: InvitationRecord;
  project: ShareProjectSummary | null;
  scan: ShareScanSummary | null;
  /** Present only for invitations bound to a recipient user. */
  recipient?: ShareRecipientUser | null;
  creator?: ShareUserSummary | null;
}

/** An invitation row joined with the recipient fields the Owner's share list shows. */
export interface PendingInvitationRow {
  invitation: InvitationRecord;
  recipient: ShareRecipientUser | null;
}

/**
 * An invitation is addressed either to a typed-in email address or to a specific
 * user identified by their public id — exactly one, never both.
 */
export type InvitationCreateInput = { expiresInSeconds?: number } & (
  | { recipientEmail: string; recipientPublicUserId?: never }
  | { recipientPublicUserId: string; recipientEmail?: never }
);

export interface InvitationSendResult {
  invitationId: string;
  invitationUrl: string;
  recipientEmail: string | null;
  recipientPublicUserId: string | null;
  expiresAt: string;
  status: 'PENDING';
  sentAt: string;
}

export type InvitationCreateResult = InvitationSendResult;
export type InvitationResendResult = InvitationSendResult;

export type ShareEntityPreview = ShareProjectPreview | ShareScanSummary | null;

export interface InvitationPreviewResult {
  type: 'invitation';
  scope: ShareScope;
  project: ShareProjectPreview | null;
  scan: ShareScanPreview | null;
  status: InvitationViewStatus;
  recipientEmail: string | null;
  recipientPublicUserId: string | null;
  sentAt: string;
  expiresAt: string;
  hasAccess?: boolean;
}

export interface ShareLinkPreviewResult {
  type: 'share-link';
  scope: ShareScope;
  project: ShareProjectPreview | null;
  scan: ShareScanPreview | null;
  status: ShareLinkViewStatus;
  expiresAt: string;
  hasAccess?: boolean;
}

export type TokenPreviewResult = InvitationPreviewResult | ShareLinkPreviewResult;

export interface InvitationAcceptResult {
  type: 'invitation';
  invitationId: string;
  scope: ShareScope;
  project: ShareProjectSummary | null;
  scan: ShareScanSummary | null;
  access: {
    role: 'VIEWER';
    status: 'ACTIVE';
    grantedAt: string;
  };
}

export interface ShareLinkAcceptResult {
  type: 'share-link';
  shareLinkId: string;
  scope: ShareScope;
  project: ShareProjectSummary | null;
  scan: ShareScanSummary | null;
  access: {
    role: 'VIEWER';
    status: 'ACTIVE';
    grantedAt: string;
  };
}

export type TokenAcceptResult = InvitationAcceptResult | ShareLinkAcceptResult;

export interface InvitationDeclineResult {
  invitationId: string;
  status: 'DECLINED';
  declinedAt: string;
}

export interface InvitationRevokeResult {
  invitationId: string;
  status: 'REVOKED';
  revokedAt: string;
}

export interface PendingInvitationResult {
  invitationId: string;
  recipientEmail: string | null;
  recipientPublicUserId: string | null;
  recipientDisplayName: string | null;
  status: 'PENDING' | 'EXPIRED';
  sentAt: string;
  expiresAt: string;
}

/** One entry of the signed-in user's invitation inbox. */
export interface ReceivedInvitationResult {
  invitationId: string;
  scope: ShareScope;
  project: ShareProjectPreview | null;
  scan: ShareScanPreview | null;
  status: InvitationViewStatus;
  invitedBy: ShareUserSummary | null;
  sentAt: string;
  expiresAt: string;
}

export interface ReceivedInvitationsResult {
  items: ReceivedInvitationResult[];
  pagination: PaginationMeta;
}

export interface ViewerResult {
  userId: string;
  revision?: number;
  recipientUser: ShareUserSummary;
  grantedAt: string;
}

export interface SharesListResult {
  pendingInvitations: PendingInvitationResult[];
  viewers: ViewerResult[];
}

export interface ViewerRevokeResult {
  projectId: string;
  userId: string;
  revision: number;
  revokedAt: string;
}

export interface ScanViewerRevokeResult {
  scanId: string;
  userId: string;
  revokedAt: string;
}

export interface ShareLinkRecord {
  id: string;
  projectId: string | null;
  scanId: string | null;
  createdById: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ShareLinkWithEntity {
  shareLink: ShareLinkRecord;
  project: ShareProjectSummary | null;
  scan: ShareScanSummary | null;
}

export interface ShareLinkCreateResult {
  shareLinkId: string;
  shareLinkUrl: string;
  scope: ShareScope;
  expiresAt: string;
}

export interface ShareLinkListResult {
  shareLinkId: string;
  status: ShareLinkViewStatus;
  expiresAt: string;
  createdAt: string;
}

export interface ShareLinkRevokeResult {
  shareLinkId: string;
  status: 'REVOKED';
  revokedAt: string;
}

export interface ScanSharesListResult {
  pendingInvitations: PendingInvitationResult[];
  viewers: ViewerResult[];
  shareLinks: ShareLinkListResult[];
}

export interface ShareProjectInfo {
  name: string;
  ownerId: string;
  ownerEmail: string | null;
}

export interface ShareScanInfo {
  name: string;
  projectId: string;
  ownerId: string;
  ownerEmail: string | null;
}

export type ShareLinkCreateData = {
  createdById: string;
  tokenHash: string;
  expiresAt: Date;
} & ({ projectId: string; scanId?: never } | { scanId: string; projectId?: never });

export type InvitationRecipientData =
  | { recipientEmail: string; recipientUserId?: never }
  | { recipientUserId: string; recipientEmail?: never };

export type InvitationCreateData = {
  createdById: string;
  tokenHash: string;
  expiresAt: Date;
  sentAt: Date;
} & InvitationRecipientData &
  ({ projectId: string; scanId?: never } | { scanId: string; projectId?: never });

export type ShareLinkResourceData =
  { projectId: string; scanId?: never } | { scanId: string; projectId?: never };

export interface ShareRepository {
  findProjectOwner(projectId: string): Promise<string | null>;
  findProjectInfo(projectId: string): Promise<ShareProjectInfo | null>;
  hasUploadedModel(projectId: string): Promise<boolean>;
  findScanInfo(scanId: string): Promise<ShareScanInfo | null>;
  hasUploadedScanModel(scanId: string): Promise<boolean>;
  createInvitation(data: InvitationCreateData): Promise<InvitationRecord>;
  createInvitationIdempotently?(
    data: {
      id: string;
      projectId: string;
      createdById: string;
      tokenHash: string;
      expiresAt: Date;
      sentAt: Date;
    } & InvitationRecipientData,
    context: IdempotencyContext,
    result: InvitationCreateResult,
  ): Promise<IdempotencyResult<InvitationCreateResult>>;
  /** Bulk-transitions PENDING invitations past `expiresAt` to REVOKED. Returns the count affected. */
  expirePendingInvitations(now: Date): Promise<number>;
  findByTokenHash(tokenHash: string): Promise<InvitationWithEntity | null>;
  findUserByPublicId(publicUserId: string): Promise<ShareRecipientUser | null>;
  findUserById(userId: string): Promise<ShareRecipientUser | null>;
  /** Resolves an invitation by id, but only when it is bound to `userId` as its recipient. */
  findInvitationForRecipient(
    invitationId: string,
    userId: string,
  ): Promise<InvitationWithEntity | null>;
  /** Invitations addressed to `userId` by public id, newest first. */
  listReceivedInvitations(
    userId: string,
    pagination: PaginationParams,
  ): Promise<{ items: InvitationWithEntity[]; total: number }>;
  findTokenSourceKindByTokenHash(tokenHash: string): Promise<'invitation' | 'share-link' | null>;
  findInvitationById(id: string): Promise<InvitationRecord | null>;
  acceptInvitation(
    invitationId: string,
    projectId: string,
    userId: string,
    acceptedAt: Date,
  ): Promise<InvitationRecord | null>;
  acceptScanInvitation(
    invitationId: string,
    scanId: string,
    userId: string,
    acceptedAt: Date,
  ): Promise<InvitationRecord | null>;
  declineInvitation(invitationId: string, declinedAt: Date): Promise<InvitationRecord | null>;
  revokeInvitation(id: string, revokedAt: Date): Promise<InvitationRecord | null>;
  resendInvitation(
    id: string,
    data: { tokenHash: string; sentAt: Date; expiresAt: Date },
  ): Promise<InvitationRecord | null>;
  listPendingByProject(projectId: string): Promise<PendingInvitationRow[]>;
  listPendingByScan(scanId: string): Promise<PendingInvitationRow[]>;
  findActiveViewerAccess(projectId: string, userId: string): Promise<{ id: string } | null>;
  findActiveScanAccess(scanId: string, userId: string): Promise<{ id: string } | null>;
  listActiveViewers(projectId: string): Promise<
    Array<{
      userId: string;
      revision: number;
      user: ShareUserSummary;
      grantedAt: Date;
    }>
  >;
  listActiveScanViewers(
    scanId: string,
  ): Promise<Array<{ userId: string; user: ShareUserSummary; grantedAt: Date }>>;
  revokeViewerAccess(
    projectId: string,
    userId: string,
    revokedAt: Date,
  ): Promise<{ revokedAt: Date; revision: number } | null>;
  revokeScanViewerAccess(
    scanId: string,
    userId: string,
    revokedAt: Date,
  ): Promise<{ revokedAt: Date } | null>;
  createShareLink(data: ShareLinkCreateData): Promise<ShareLinkRecord>;
  findShareLinkByTokenHash(tokenHash: string): Promise<ShareLinkWithEntity | null>;
  findShareLinkById(id: string): Promise<ShareLinkRecord | null>;
  listShareLinksByResource(data: ShareLinkResourceData): Promise<ShareLinkRecord[]>;
  revokeShareLink(id: string, revokedAt: Date): Promise<ShareLinkRecord | null>;
  grantProjectAccess(
    projectId: string,
    userId: string,
    shareLinkId: string,
    acceptedAt: Date,
  ): Promise<{ id: string }>;
  grantScanAccess(
    scanId: string,
    userId: string,
    shareLinkId: string,
    acceptedAt: Date,
  ): Promise<{ id: string }>;
}
