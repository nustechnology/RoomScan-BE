import { createHash, randomBytes } from 'node:crypto';

import { ProjectNotFoundError } from '../project/project.errors.js';
import {
  AccessAlreadyExistsError,
  CannotAcceptOwnInvitationError,
  InvitationDeclinedError,
  InvitationExpiredError,
  InvitationNotFoundError,
  InvitationRevokedError,
  NotOwnerError,
  ProjectNotShareableError,
  ViewerAccessNotFoundError,
} from './share.errors.js';
import type {
  InvitationAcceptResult,
  InvitationCreateInput,
  InvitationCreateResult,
  InvitationDeclineResult,
  InvitationPreviewResult,
  InvitationRecord,
  InvitationRevokeResult,
  InvitationViewStatus,
  ShareRepository,
  SharesListResult,
  ViewerRevokeResult,
} from './share.types.js';

export interface ShareServiceDependencies {
  repository: ShareRepository;
  clock?: () => Date;
  invitationTtlSeconds: number;
  invitationBaseUrl: string;
}

export function generateInvitationToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class ShareService {
  readonly #repository: ShareRepository;
  readonly #clock: () => Date;
  readonly #invitationTtlSeconds: number;
  readonly #invitationBaseUrl: string;

  constructor({
    repository,
    clock,
    invitationTtlSeconds,
    invitationBaseUrl,
  }: ShareServiceDependencies) {
    this.#repository = repository;
    this.#clock = clock ?? (() => new Date());
    this.#invitationTtlSeconds = invitationTtlSeconds;
    this.#invitationBaseUrl = invitationBaseUrl;
  }

  #viewStatus(record: InvitationRecord): InvitationViewStatus {
    if (record.status === 'REVOKED') {
      return 'REVOKED';
    }
    if (record.expiresAt.getTime() <= this.#clock().getTime()) {
      return 'EXPIRED';
    }
    return 'PENDING';
  }

  async #requireProjectOwner(projectId: string, userId: string): Promise<void> {
    const ownerId = await this.#repository.findProjectOwner(projectId);

    if (ownerId === null) {
      throw new ProjectNotFoundError();
    }
    if (ownerId !== userId) {
      throw new NotOwnerError();
    }
  }

  async #loadInvitation(rawToken: string): Promise<{
    invitation: InvitationRecord;
    project: {
      id: string;
      name: string;
      description: string | null;
      thumbnail: string | null;
      owner: { id: string; email: string | null };
    };
  }> {
    const invitation = await this.#repository.findByTokenHash(hashInvitationToken(rawToken));

    if (invitation === null) {
      throw new InvitationNotFoundError();
    }

    return invitation;
  }

  async createInvitation(
    userId: string,
    projectId: string,
    data: InvitationCreateInput,
  ): Promise<InvitationCreateResult> {
    await this.#requireProjectOwner(projectId, userId);

    if (!(await this.#repository.hasUploadedModel(projectId))) {
      throw new ProjectNotShareableError();
    }

    const now = this.#clock();
    const ttlSeconds = data.expiresInSeconds ?? this.#invitationTtlSeconds;
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    const rawToken = generateInvitationToken();
    const record = await this.#repository.createInvitation({
      projectId,
      createdById: userId,
      tokenHash: hashInvitationToken(rawToken),
      expiresAt,
      sentAt: now,
    });

    return {
      invitationId: record.id,
      invitationUrl: `${this.#invitationBaseUrl}/invitations/${rawToken}`,
      expiresAt: expiresAt.toISOString(),
      status: 'PENDING',
    };
  }

  async previewInvitation(rawToken: string, userId?: string): Promise<InvitationPreviewResult> {
    const { invitation, project } = await this.#loadInvitation(rawToken);
    const result: InvitationPreviewResult = {
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
        thumbnail: project.thumbnail,
      },
      status: this.#viewStatus(invitation),
      sentAt: invitation.sentAt.toISOString(),
      expiresAt: invitation.expiresAt.toISOString(),
    };

    if (userId !== undefined) {
      result.hasAccess =
        (await this.#repository.findActiveViewerAccess(project.id, userId)) !== null;
    }

    return result;
  }

  async #validateAcceptable(
    rawToken: string,
    userId: string,
  ): Promise<{
    invitation: InvitationRecord;
    projectId: string;
    project: InvitationAcceptResult['project'];
  }> {
    const { invitation, project } = await this.#loadInvitation(rawToken);

    if (invitation.status === 'REVOKED') {
      throw new InvitationRevokedError();
    }
    if (invitation.expiresAt.getTime() <= this.#clock().getTime()) {
      throw new InvitationExpiredError();
    }
    if (project.owner.id === userId) {
      throw new CannotAcceptOwnInvitationError();
    }
    if ((await this.#repository.findActiveViewerAccess(project.id, userId)) !== null) {
      throw new AccessAlreadyExistsError();
    }
    if ((await this.#repository.findDeclinedAccess(project.id, userId, invitation.id)) !== null) {
      throw new InvitationDeclinedError();
    }

    return { invitation, projectId: project.id, project };
  }

  async acceptInvitation(userId: string, rawToken: string): Promise<InvitationAcceptResult> {
    const { invitation, projectId, project } = await this.#validateAcceptable(rawToken, userId);
    const now = this.#clock();
    await this.#repository.acceptInvitation(projectId, userId, invitation.id, now);

    return {
      project,
      access: {
        role: 'VIEWER',
        status: 'ACTIVE',
        grantedAt: now.toISOString(),
      },
    };
  }

  async declineInvitation(userId: string, rawToken: string): Promise<InvitationDeclineResult> {
    const { invitation, projectId } = await this.#validateAcceptable(rawToken, userId);
    const now = this.#clock();
    await this.#repository.declineInvitation(projectId, userId, invitation.id, now);

    return {
      invitationId: invitation.id,
      status: 'DECLINED',
      declinedAt: now.toISOString(),
    };
  }

  async revokeInvitation(userId: string, invitationId: string): Promise<InvitationRevokeResult> {
    const record = await this.#repository.findInvitationById(invitationId);

    if (record === null) {
      throw new InvitationNotFoundError();
    }

    await this.#requireProjectOwner(record.projectId, userId);

    if (record.status === 'REVOKED') {
      return {
        invitationId: record.id,
        status: 'REVOKED',
        revokedAt: (record.revokedAt ?? this.#clock()).toISOString(),
      };
    }
    if (record.expiresAt.getTime() <= this.#clock().getTime()) {
      throw new InvitationExpiredError();
    }

    const now = this.#clock();
    await this.#repository.revokeInvitation(invitationId, now);

    return {
      invitationId,
      status: 'REVOKED',
      revokedAt: now.toISOString(),
    };
  }

  async listShares(userId: string, projectId: string): Promise<SharesListResult> {
    await this.#requireProjectOwner(projectId, userId);

    const invitations = await this.#repository.listPendingByProject(projectId);
    const viewers = await this.#repository.listActiveViewers(projectId);
    const now = this.#clock();

    return {
      pendingInvitations: invitations.map((invitation) => ({
        invitationId: invitation.id,
        status: invitation.expiresAt.getTime() <= now.getTime() ? 'EXPIRED' : 'PENDING',
        sentAt: invitation.sentAt.toISOString(),
        expiresAt: invitation.expiresAt.toISOString(),
      })),
      viewers: viewers.map((viewer) => ({
        userId: viewer.userId,
        recipientUser: viewer.user,
        grantedAt: viewer.grantedAt.toISOString(),
      })),
    };
  }

  async revokeViewer(
    userId: string,
    projectId: string,
    targetUserId: string,
  ): Promise<ViewerRevokeResult> {
    await this.#requireProjectOwner(projectId, userId);

    const result = await this.#repository.revokeViewerAccess(
      projectId,
      targetUserId,
      this.#clock(),
    );

    if (result === null) {
      throw new ViewerAccessNotFoundError();
    }

    return {
      projectId,
      userId: targetUserId,
      revokedAt: result.revokedAt.toISOString(),
    };
  }
}
