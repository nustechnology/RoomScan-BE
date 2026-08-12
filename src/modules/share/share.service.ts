import { createHash, randomBytes } from 'node:crypto';

import type { Logger } from 'pino';

import type { Mailer } from '../../infrastructure/mail/mailer.types.js';
import { ProjectNotFoundError } from '../project/project.errors.js';
import { buildInvitationEmail } from './share.email.js';
import {
  AccessAlreadyExistsError,
  CannotAcceptOwnInvitationError,
  InvitationAlreadyAcceptedError,
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
  InvitationResendResult,
  InvitationRevokeResult,
  InvitationViewStatus,
  ShareRepository,
  SharesListResult,
  ViewerRevokeResult,
} from './share.types.js';

export interface ShareServiceDependencies {
  repository: ShareRepository;
  mailer: Mailer;
  logger: Logger;
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
  readonly #mailer: Mailer;
  readonly #logger: Logger;
  readonly #clock: () => Date;
  readonly #invitationTtlSeconds: number;
  readonly #invitationBaseUrl: string;

  constructor({
    repository,
    mailer,
    logger,
    clock,
    invitationTtlSeconds,
    invitationBaseUrl,
  }: ShareServiceDependencies) {
    this.#repository = repository;
    this.#mailer = mailer;
    this.#logger = logger;
    this.#clock = clock ?? (() => new Date());
    this.#invitationTtlSeconds = invitationTtlSeconds;
    this.#invitationBaseUrl = invitationBaseUrl;
  }

  #viewStatus(record: InvitationRecord): InvitationViewStatus {
    if (record.status === 'REVOKED') {
      return 'REVOKED';
    }
    if (record.status === 'ACCEPTED') {
      return 'ACCEPTED';
    }
    if (record.status === 'DECLINED') {
      return 'DECLINED';
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

  async #sendInvitationEmail(input: {
    recipientEmail: string;
    ownerDisplay: string;
    entityName: string;
    invitationUrl: string;
    expiresInSeconds: number;
  }): Promise<void> {
    const email = buildInvitationEmail({
      scope: 'project',
      ownerDisplay: input.ownerDisplay,
      recipientEmail: input.recipientEmail,
      entityName: input.entityName,
      invitationUrl: input.invitationUrl,
      expiresInSeconds: input.expiresInSeconds,
    });

    try {
      await this.#mailer.sendMail({
        to: input.recipientEmail,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });
    } catch (error) {
      this.#logger.warn(
        { err: error, to: input.recipientEmail },
        'Failed to deliver an invitation email',
      );
    }
  }

  async createInvitation(
    userId: string,
    projectId: string,
    data: InvitationCreateInput,
  ): Promise<InvitationCreateResult> {
    const info = await this.#repository.findProjectInfo(projectId);

    if (info === null) {
      throw new ProjectNotFoundError();
    }
    if (info.ownerId !== userId) {
      throw new NotOwnerError();
    }
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
      recipientEmail: data.recipientEmail,
      tokenHash: hashInvitationToken(rawToken),
      expiresAt,
      sentAt: now,
    });

    const invitationUrl = `${this.#invitationBaseUrl}/invitations/${rawToken}`;
    await this.#sendInvitationEmail({
      recipientEmail: data.recipientEmail,
      ownerDisplay: info.ownerEmail ?? 'the project owner',
      entityName: info.name,
      invitationUrl,
      expiresInSeconds: ttlSeconds,
    });

    return {
      invitationId: record.id,
      invitationUrl,
      recipientEmail: record.recipientEmail,
      expiresAt: expiresAt.toISOString(),
      status: 'PENDING',
      sentAt: now.toISOString(),
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
      recipientEmail: invitation.recipientEmail,
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
    if (invitation.status === 'ACCEPTED') {
      throw new InvitationAlreadyAcceptedError();
    }
    if (invitation.status === 'DECLINED') {
      throw new InvitationDeclinedError();
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

    return { invitation, projectId: project.id, project };
  }

  async acceptInvitation(userId: string, rawToken: string): Promise<InvitationAcceptResult> {
    const { invitation, projectId, project } = await this.#validateAcceptable(rawToken, userId);
    const now = this.#clock();
    const updated = await this.#repository.acceptInvitation(invitation.id, projectId, userId, now);

    if (updated === null) {
      throw new InvitationAlreadyAcceptedError();
    }

    return {
      invitationId: updated.id,
      project,
      access: {
        role: 'VIEWER',
        status: 'ACTIVE',
        grantedAt: (updated.acceptedAt ?? now).toISOString(),
      },
    };
  }

  async declineInvitation(userId: string, rawToken: string): Promise<InvitationDeclineResult> {
    const { invitation } = await this.#validateAcceptable(rawToken, userId);
    const now = this.#clock();
    const updated = await this.#repository.declineInvitation(invitation.id, now);

    if (updated === null) {
      throw new InvitationDeclinedError();
    }

    return {
      invitationId: updated.id,
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
    if (record.status === 'ACCEPTED') {
      throw new InvitationAlreadyAcceptedError();
    }
    if (record.status === 'DECLINED') {
      throw new InvitationDeclinedError();
    }
    if (record.expiresAt.getTime() <= this.#clock().getTime()) {
      throw new InvitationExpiredError();
    }

    const now = this.#clock();
    const updated = await this.#repository.revokeInvitation(invitationId, now);

    if (updated === null) {
      throw new InvitationNotFoundError();
    }

    return {
      invitationId,
      status: 'REVOKED',
      revokedAt: now.toISOString(),
    };
  }

  async resendInvitation(userId: string, invitationId: string): Promise<InvitationResendResult> {
    const record = await this.#repository.findInvitationById(invitationId);

    if (record === null) {
      throw new InvitationNotFoundError();
    }

    await this.#requireProjectOwner(record.projectId, userId);

    if (record.status === 'REVOKED') {
      throw new InvitationRevokedError();
    }
    if (record.status === 'ACCEPTED') {
      throw new InvitationAlreadyAcceptedError();
    }
    if (record.status === 'DECLINED') {
      throw new InvitationDeclinedError();
    }
    if (record.expiresAt.getTime() <= this.#clock().getTime()) {
      throw new InvitationExpiredError();
    }

    const info = await this.#repository.findProjectInfo(record.projectId);
    if (info === null) {
      throw new ProjectNotFoundError();
    }

    const now = this.#clock();
    const expiresAt = new Date(now.getTime() + this.#invitationTtlSeconds * 1000);
    const rawToken = generateInvitationToken();
    const updated = await this.#repository.resendInvitation(invitationId, {
      tokenHash: hashInvitationToken(rawToken),
      sentAt: now,
      expiresAt,
    });

    if (updated === null) {
      throw new InvitationNotFoundError();
    }

    const invitationUrl = `${this.#invitationBaseUrl}/invitations/${rawToken}`;
    await this.#sendInvitationEmail({
      recipientEmail: updated.recipientEmail,
      ownerDisplay: info.ownerEmail ?? 'the project owner',
      entityName: info.name,
      invitationUrl,
      expiresInSeconds: this.#invitationTtlSeconds,
    });

    return {
      invitationId: updated.id,
      invitationUrl,
      recipientEmail: updated.recipientEmail,
      expiresAt: expiresAt.toISOString(),
      status: 'PENDING',
      sentAt: now.toISOString(),
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
        recipientEmail: invitation.recipientEmail,
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
