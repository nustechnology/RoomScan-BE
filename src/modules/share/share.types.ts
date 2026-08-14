export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'REVOKED';
export type InvitationViewStatus = 'PENDING' | 'EXPIRED' | 'ACCEPTED' | 'DECLINED' | 'REVOKED';

export interface ShareProjectSummary {
  id: string;
  name: string;
  description: string | null;
  thumbnail: string | null;
  owner: {
    id: string;
    email: string | null;
  };
}

export interface InvitationRecord {
  id: string;
  projectId: string;
  createdById: string;
  recipientEmail: string;
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

export interface InvitationWithProject {
  invitation: InvitationRecord;
  project: ShareProjectSummary;
}

export interface InvitationCreateInput {
  recipientEmail: string;
  expiresInSeconds?: number;
}

export interface InvitationSendResult {
  invitationId: string;
  invitationUrl: string;
  recipientEmail: string;
  expiresAt: string;
  status: 'PENDING';
  sentAt: string;
}

export type InvitationCreateResult = InvitationSendResult;
export type InvitationResendResult = InvitationSendResult;

export interface InvitationPreviewResult {
  project: {
    id: string;
    name: string;
    description: string | null;
    thumbnail: string | null;
  };
  status: InvitationViewStatus;
  recipientEmail: string;
  sentAt: string;
  expiresAt: string;
  hasAccess?: boolean;
}

export interface InvitationAcceptResult {
  invitationId: string;
  project: ShareProjectSummary;
  access: {
    role: 'VIEWER';
    status: 'ACTIVE';
    grantedAt: string;
  };
}

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
  recipientEmail: string;
  status: 'PENDING' | 'EXPIRED';
  sentAt: string;
  expiresAt: string;
}

export interface ViewerResult {
  userId: string;
  recipientUser: {
    id: string;
    email: string | null;
  };
  grantedAt: string;
}

export interface SharesListResult {
  pendingInvitations: PendingInvitationResult[];
  viewers: ViewerResult[];
}

export interface ViewerRevokeResult {
  projectId: string;
  userId: string;
  revokedAt: string;
}

export interface ShareProjectInfo {
  name: string;
  ownerId: string;
  ownerEmail: string | null;
}

export interface ShareRepository {
  findProjectOwner(projectId: string): Promise<string | null>;
  findProjectInfo(projectId: string): Promise<ShareProjectInfo | null>;
  hasUploadedModel(projectId: string): Promise<boolean>;
  createInvitation(data: {
    projectId: string;
    createdById: string;
    recipientEmail: string;
    tokenHash: string;
    expiresAt: Date;
    sentAt: Date;
  }): Promise<InvitationRecord>;
  findByTokenHash(tokenHash: string): Promise<InvitationWithProject | null>;
  findInvitationById(id: string): Promise<InvitationRecord | null>;
  acceptInvitation(
    invitationId: string,
    projectId: string,
    userId: string,
    acceptedAt: Date,
  ): Promise<InvitationRecord | null>;
  declineInvitation(invitationId: string, declinedAt: Date): Promise<InvitationRecord | null>;
  revokeInvitation(id: string, revokedAt: Date): Promise<InvitationRecord | null>;
  resendInvitation(
    id: string,
    data: { tokenHash: string; sentAt: Date; expiresAt: Date },
  ): Promise<InvitationRecord | null>;
  listPendingByProject(projectId: string): Promise<InvitationRecord[]>;
  findActiveViewerAccess(projectId: string, userId: string): Promise<{ id: string } | null>;
  listActiveViewers(
    projectId: string,
  ): Promise<
    Array<{ userId: string; user: { id: string; email: string | null }; grantedAt: Date }>
  >;
  revokeViewerAccess(
    projectId: string,
    userId: string,
    revokedAt: Date,
  ): Promise<{ revokedAt: Date } | null>;
}
