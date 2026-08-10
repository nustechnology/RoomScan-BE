export type InvitationStatus = 'PENDING' | 'REVOKED';
export type InvitationViewStatus = 'PENDING' | 'EXPIRED' | 'REVOKED';

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
  tokenHash: string;
  status: InvitationStatus;
  expiresAt: Date;
  sentAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InvitationWithProject {
  invitation: InvitationRecord;
  project: ShareProjectSummary;
}

export interface InvitationCreateInput {
  expiresInSeconds?: number;
}

export interface InvitationCreateResult {
  invitationId: string;
  invitationUrl: string;
  expiresAt: string;
  status: 'PENDING';
}

export interface InvitationPreviewResult {
  project: {
    id: string;
    name: string;
    description: string | null;
    thumbnail: string | null;
  };
  status: InvitationViewStatus;
  sentAt: string;
  expiresAt: string;
  hasAccess?: boolean;
}

export interface InvitationAcceptResult {
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

export interface ShareRepository {
  findProjectOwner(projectId: string): Promise<string | null>;
  hasUploadedModel(projectId: string): Promise<boolean>;
  createInvitation(data: {
    projectId: string;
    createdById: string;
    tokenHash: string;
    expiresAt: Date;
    sentAt: Date;
  }): Promise<InvitationRecord>;
  findByTokenHash(tokenHash: string): Promise<InvitationWithProject | null>;
  findInvitationById(id: string): Promise<InvitationRecord | null>;
  revokeInvitation(id: string, revokedAt: Date): Promise<InvitationRecord | null>;
  listPendingByProject(projectId: string): Promise<InvitationRecord[]>;
  findActiveViewerAccess(projectId: string, userId: string): Promise<{ id: string } | null>;
  findDeclinedAccess(
    projectId: string,
    userId: string,
    invitationId: string,
  ): Promise<{ id: string } | null>;
  acceptInvitation(
    projectId: string,
    userId: string,
    invitationId: string,
    acceptedAt: Date,
  ): Promise<void>;
  declineInvitation(
    projectId: string,
    userId: string,
    invitationId: string,
    declinedAt: Date,
  ): Promise<void>;
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
