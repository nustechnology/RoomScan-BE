import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { Logger } from 'pino';

import type {
  IdempotencyGateway,
  IdempotencyResult,
} from '../../common/idempotency/idempotency.types.js';
import type { Mailer } from '../../infrastructure/mail/mailer.types.js';
import { ProjectNotFoundError } from '../project/project.errors.js';
import { ScanNotFoundError } from '../scan/scan.errors.js';
import { buildInvitationEmail } from './share.email.js';
import {
  AccessAlreadyExistsError,
  CannotAcceptOwnInvitationError,
  InvitationAlreadyAcceptedError,
  InvitationDeclinedError,
  InvitationExpiredError,
  InvitationNotFoundError,
  InvitationNotForUserError,
  InvitationRevokedError,
  NotOwnerError,
  ProjectNotShareableError,
  ScanNotShareableError,
  ShareLinkExpiredError,
  ShareLinkNotFoundError,
  ShareNoLongerAvailableError,
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
  InvitationWithEntity,
  ShareLinkAcceptResult,
  ShareLinkPreviewResult,
  ShareLinkRecord,
  ShareLinkWithEntity,
  ShareProjectPreview,
  ShareProjectSummary,
  ShareRepository,
  ShareScanPreview,
  ShareScope,
  SharesListResult,
  ShareScanSummary,
  TokenAcceptResult,
  TokenPreviewResult,
  ViewerRevokeResult,
} from './share.types.js';

export interface ShareServiceDependencies {
  repository: ShareRepository;
  mailer: Mailer;
  logger: Logger;
  clock?: () => Date;
  invitationTtlSeconds: number;
  invitationBaseUrl: string;
  idempotency?: IdempotencyGateway;
}

export interface PreviewContextUser {
  id: string;
  email: string | null;
}

export function generateInvitationToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function toPreviewProject(project: ShareProjectSummary | null): ShareProjectPreview | null {
  if (project === null) {
    return null;
  }
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    thumbnail: project.thumbnail,
    owner: project.owner,
    scanCount: project.scanCount,
  };
}

function toPreviewScan(scan: ShareScanSummary | null): ShareScanPreview | null {
  if (scan === null) {
    return null;
  }
  return {
    id: scan.id,
    projectId: scan.projectId,
    name: scan.name,
    description: scan.description,
    thumbnail: scan.thumbnail,
    noteCount: scan.noteCount,
    creator: scan.creator,
  };
}

export class ShareService {
  readonly #repository: ShareRepository;
  readonly #mailer: Mailer;
  readonly #logger: Logger;
  readonly #clock: () => Date;
  readonly #invitationTtlSeconds: number;
  readonly #invitationBaseUrl: string;
  readonly #idempotency: IdempotencyGateway | undefined;

  constructor({
    repository,
    mailer,
    logger,
    clock,
    invitationTtlSeconds,
    invitationBaseUrl,
    idempotency,
  }: ShareServiceDependencies) {
    this.#repository = repository;
    this.#mailer = mailer;
    this.#logger = logger;
    this.#clock = clock ?? (() => new Date());
    this.#invitationTtlSeconds = invitationTtlSeconds;
    this.#invitationBaseUrl = invitationBaseUrl;
    this.#idempotency = idempotency;
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

  #inviteUrl(rawToken: string, scope: ShareScope): string {
    return `${this.#invitationBaseUrl}/invitations/${rawToken}?scope=${scope}`;
  }

  #scopeOf(record: InvitationRecord | ShareLinkRecord): ShareScope {
    return record.scanId !== null ? 'scan' : 'project';
  }

  #entityOf(context: InvitationWithEntity | ShareLinkWithEntity): {
    scope: ShareScope;
    project: ShareProjectSummary | null;
    scan: ShareScanSummary | null;
    ownerId: string | null;
  } {
    if ('invitation' in context) {
      const scope = this.#scopeOf(context.invitation);
      const project = scope === 'project' ? context.project : null;
      const scan = scope === 'scan' ? context.scan : null;
      return {
        scope,
        project,
        scan,
        ownerId:
          scope === 'project'
            ? (context.project?.owner.id ?? null)
            : (context.scan?.ownerId ?? null),
      };
    }
    const scope = this.#scopeOf(context.shareLink);
    const project = scope === 'project' ? context.project : null;
    const scan = scope === 'scan' ? context.scan : null;
    return {
      scope,
      project,
      scan,
      ownerId:
        scope === 'project' ? (context.project?.owner.id ?? null) : (context.scan?.ownerId ?? null),
    };
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

  async #requireOwnerOfInvitation(record: InvitationRecord, userId: string): Promise<void> {
    if (record.projectId !== null) {
      await this.#requireProjectOwner(record.projectId, userId);
      return;
    }
    if (record.scanId === null) {
      throw new InvitationNotFoundError();
    }
    const info = await this.#repository.findScanInfo(record.scanId);
    if (info === null) {
      throw new InvitationNotFoundError();
    }
    if (info.ownerId !== userId) {
      throw new NotOwnerError();
    }
  }

  async #sendInvitationEmail(input: {
    scope: ShareScope;
    recipientEmail: string;
    ownerDisplay: string;
    entityName: string;
    invitationUrl: string;
    expiresInSeconds: number;
  }): Promise<void> {
    const email = buildInvitationEmail({
      scope: input.scope,
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

  #assertRecipientMatch(recipientEmail: string, currentUser: PreviewContextUser): void {
    const matches =
      currentUser.email !== null &&
      recipientEmail.toLowerCase() === currentUser.email.toLowerCase();

    if (!matches) {
      throw new InvitationNotForUserError();
    }
  }

  async #hasActiveAccess(scope: ShareScope, entityId: string, userId: string): Promise<boolean> {
    if (scope === 'project') {
      return (await this.#repository.findActiveViewerAccess(entityId, userId)) !== null;
    }
    return (await this.#repository.findActiveScanAccess(entityId, userId)) !== null;
  }

  async #grantAccessFromShareLink(
    shareLink: ShareLinkWithEntity,
    userId: string,
    acceptedAt: Date,
  ): Promise<ShareLinkAcceptResult> {
    const { scope, project, scan } = this.#entityOf(shareLink);

    if (scope === 'project') {
      if (project === null) {
        throw new ShareLinkNotFoundError();
      }
      if (await this.#hasActiveAccess(scope, project.id, userId)) {
        throw new AccessAlreadyExistsError();
      }
      await this.#repository.grantProjectAccess(
        project.id,
        userId,
        shareLink.shareLink.id,
        acceptedAt,
      );
      return {
        type: 'share-link',
        shareLinkId: shareLink.shareLink.id,
        scope,
        project,
        scan: null,
        access: { role: 'VIEWER', status: 'ACTIVE', grantedAt: acceptedAt.toISOString() },
      };
    }

    if (scan === null) {
      throw new ShareLinkNotFoundError();
    }
    if (await this.#hasActiveAccess(scope, scan.id, userId)) {
      throw new AccessAlreadyExistsError();
    }
    await this.#repository.grantScanAccess(scan.id, userId, shareLink.shareLink.id, acceptedAt);
    return {
      type: 'share-link',
      shareLinkId: shareLink.shareLink.id,
      scope,
      project: null,
      scan,
      access: { role: 'VIEWER', status: 'ACTIVE', grantedAt: acceptedAt.toISOString() },
    };
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

    const invitationUrl = this.#inviteUrl(rawToken, 'project');
    await this.#sendInvitationEmail({
      scope: 'project',
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

  async createInvitationIdempotently(
    userId: string,
    projectId: string,
    data: InvitationCreateInput,
    key: string,
  ): Promise<IdempotencyResult<InvitationCreateResult>> {
    if (
      this.#idempotency === undefined ||
      this.#repository.createInvitationIdempotently === undefined
    ) {
      throw new Error('Invitation idempotency is not configured');
    }
    const context = this.#idempotency.createContext({
      userId,
      operation: 'CREATE_INVITATION',
      parentScope: `project:${projectId}`,
      key,
      request: data,
    });
    const replay = await this.#idempotency.lookup<InvitationCreateResult>(context);
    if (replay !== null) return replay;

    const info = await this.#repository.findProjectInfo(projectId);
    if (info === null) throw new ProjectNotFoundError();
    if (info.ownerId !== userId) throw new NotOwnerError();
    if (!(await this.#repository.hasUploadedModel(projectId))) {
      throw new ProjectNotShareableError();
    }

    const now = this.#clock();
    const ttlSeconds = data.expiresInSeconds ?? this.#invitationTtlSeconds;
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    const rawToken = generateInvitationToken();
    const invitationId = randomUUID();
    const invitationUrl = `${this.#invitationBaseUrl}/invitations/${rawToken}`;
    const responseBody: InvitationCreateResult = {
      invitationId,
      invitationUrl,
      recipientEmail: data.recipientEmail,
      expiresAt: expiresAt.toISOString(),
      status: 'PENDING',
      sentAt: now.toISOString(),
    };
    const result = await this.#repository.createInvitationIdempotently(
      {
        id: invitationId,
        projectId,
        createdById: userId,
        recipientEmail: data.recipientEmail,
        tokenHash: hashInvitationToken(rawToken),
        expiresAt,
        sentAt: now,
      },
      context,
      responseBody,
    );
    if (!result.replayed) {
      await this.#sendInvitationEmail({
        scope: 'project',
        recipientEmail: data.recipientEmail,
        ownerDisplay: info.ownerEmail ?? 'the project owner',
        entityName: info.name,
        invitationUrl,
        expiresInSeconds: ttlSeconds,
      });
    }
    return result;
  }

  async createScanInvitation(
    userId: string,
    scanId: string,
    data: InvitationCreateInput,
  ): Promise<InvitationCreateResult> {
    const info = await this.#repository.findScanInfo(scanId);

    if (info === null) {
      throw new ScanNotFoundError();
    }
    if (info.ownerId !== userId) {
      throw new NotOwnerError();
    }
    if (!(await this.#repository.hasUploadedScanModel(scanId))) {
      throw new ScanNotShareableError();
    }

    const now = this.#clock();
    const ttlSeconds = data.expiresInSeconds ?? this.#invitationTtlSeconds;
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    const rawToken = generateInvitationToken();
    const record = await this.#repository.createInvitation({
      scanId,
      createdById: userId,
      recipientEmail: data.recipientEmail,
      tokenHash: hashInvitationToken(rawToken),
      expiresAt,
      sentAt: now,
    });

    const invitationUrl = this.#inviteUrl(rawToken, 'scan');
    await this.#sendInvitationEmail({
      scope: 'scan',
      recipientEmail: data.recipientEmail,
      ownerDisplay: info.ownerEmail ?? 'the scan owner',
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

  async previewInvitation(
    rawToken: string,
    currentUser: PreviewContextUser,
  ): Promise<TokenPreviewResult> {
    const tokenHash = hashInvitationToken(rawToken);
    const invitation = await this.#repository.findByTokenHash(tokenHash);

    if (invitation !== null) {
      this.#assertRecipientMatch(invitation.invitation.recipientEmail, currentUser);

      if (invitation.invitation.status === 'REVOKED') {
        throw new ShareNoLongerAvailableError();
      }

      const result: InvitationPreviewResult = {
        type: 'invitation',
        scope: this.#scopeOf(invitation.invitation),
        project: toPreviewProject(invitation.project),
        scan: toPreviewScan(invitation.scan),
        status: this.#viewStatus(invitation.invitation),
        recipientEmail: invitation.invitation.recipientEmail,
        sentAt: invitation.invitation.sentAt.toISOString(),
        expiresAt: invitation.invitation.expiresAt.toISOString(),
      };
      const { scope, project, scan } = this.#entityOf(invitation);
      const entityId = scope === 'project' ? project?.id : scan?.id;
      result.hasAccess =
        entityId !== undefined && (await this.#hasActiveAccess(scope, entityId, currentUser.id));

      return result;
    }

    const shareLink = await this.#repository.findShareLinkByTokenHash(
      hashInvitationToken(rawToken),
    );

    if (shareLink !== null) {
      if (shareLink.shareLink.revokedAt !== null) {
        throw new ShareNoLongerAvailableError();
      }

      const result: ShareLinkPreviewResult = {
        type: 'share-link',
        scope: this.#scopeOf(shareLink.shareLink),
        project: toPreviewProject(shareLink.project),
        scan: toPreviewScan(shareLink.scan),
        status: this.#shareLinkStatus(shareLink.shareLink),
        expiresAt: shareLink.shareLink.expiresAt.toISOString(),
      };

      const { scope, project, scan } = this.#entityOf(shareLink);
      const entityId = scope === 'project' ? project?.id : scan?.id;
      result.hasAccess =
        entityId !== undefined && (await this.#hasActiveAccess(scope, entityId, currentUser.id));

      return result;
    }

    if ((await this.#repository.findTokenSourceKindByTokenHash(tokenHash)) !== null) {
      throw new ShareNoLongerAvailableError();
    }

    throw new InvitationNotFoundError();
  }

  #shareLinkStatus(record: ShareLinkRecord): 'ACTIVE' | 'EXPIRED' | 'REVOKED' {
    if (record.revokedAt !== null) {
      return 'REVOKED';
    }
    if (record.expiresAt.getTime() <= this.#clock().getTime()) {
      return 'EXPIRED';
    }
    return 'ACTIVE';
  }

  async acceptInvitation(
    currentUser: PreviewContextUser,
    rawToken: string,
  ): Promise<TokenAcceptResult> {
    const tokenHash = hashInvitationToken(rawToken);
    const invitation = await this.#repository.findByTokenHash(tokenHash);

    if (invitation !== null) {
      return await this.#acceptEmailInvitation(invitation, currentUser);
    }

    const shareLink = await this.#repository.findShareLinkByTokenHash(tokenHash);

    if (shareLink !== null) {
      return await this.#acceptShareLink(shareLink, currentUser.id);
    }

    if ((await this.#repository.findTokenSourceKindByTokenHash(tokenHash)) !== null) {
      throw new ShareNoLongerAvailableError();
    }

    throw new InvitationNotFoundError();
  }

  async #acceptEmailInvitation(
    context: InvitationWithEntity,
    currentUser: PreviewContextUser,
  ): Promise<InvitationAcceptResult> {
    const { invitation } = context;
    const { scope, project, scan } = this.#entityOf(context);
    const userId = currentUser.id;

    if (invitation.status === 'REVOKED') {
      throw new ShareNoLongerAvailableError();
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

    const now = this.#clock();

    if (scope === 'project') {
      if (project === null) {
        throw new InvitationNotFoundError();
      }
      if (project.owner.id === userId) {
        throw new CannotAcceptOwnInvitationError();
      }
      this.#assertRecipientMatch(invitation.recipientEmail, currentUser);
      if (await this.#hasActiveAccess(scope, project.id, userId)) {
        throw new AccessAlreadyExistsError();
      }
      const updated = await this.#repository.acceptInvitation(
        invitation.id,
        project.id,
        userId,
        now,
      );
      if (updated === null) {
        throw new InvitationAlreadyAcceptedError();
      }
      return {
        type: 'invitation',
        invitationId: updated.id,
        scope,
        project,
        scan: null,
        access: {
          role: 'VIEWER',
          status: 'ACTIVE',
          grantedAt: (updated.acceptedAt ?? now).toISOString(),
        },
      };
    }

    if (scan === null) {
      throw new InvitationNotFoundError();
    }
    if (scan.ownerId === userId) {
      throw new CannotAcceptOwnInvitationError();
    }
    this.#assertRecipientMatch(invitation.recipientEmail, currentUser);
    if (await this.#hasActiveAccess(scope, scan.id, userId)) {
      throw new AccessAlreadyExistsError();
    }
    const updated = await this.#repository.acceptScanInvitation(
      invitation.id,
      scan.id,
      userId,
      now,
    );
    if (updated === null) {
      throw new InvitationAlreadyAcceptedError();
    }
    return {
      type: 'invitation',
      invitationId: updated.id,
      scope,
      project: null,
      scan,
      access: {
        role: 'VIEWER',
        status: 'ACTIVE',
        grantedAt: (updated.acceptedAt ?? now).toISOString(),
      },
    };
  }

  async #acceptShareLink(
    context: ShareLinkWithEntity,
    userId: string,
  ): Promise<ShareLinkAcceptResult> {
    const { shareLink } = context;
    const { scope, project, scan, ownerId } = this.#entityOf(context);

    if (shareLink.revokedAt !== null) {
      throw new ShareNoLongerAvailableError();
    }
    if (shareLink.expiresAt.getTime() <= this.#clock().getTime()) {
      throw new ShareLinkExpiredError();
    }
    if (ownerId === userId) {
      throw new CannotAcceptOwnInvitationError();
    }
    if (scope === 'project' && project === null) {
      throw new ShareLinkNotFoundError();
    }
    if (scope === 'scan' && scan === null) {
      throw new ShareLinkNotFoundError();
    }

    return await this.#grantAccessFromShareLink(context, userId, this.#clock());
  }

  async declineInvitation(
    currentUser: PreviewContextUser,
    rawToken: string,
  ): Promise<InvitationDeclineResult> {
    const tokenHash = hashInvitationToken(rawToken);
    const invitation = await this.#repository.findByTokenHash(tokenHash);

    if (invitation === null) {
      if ((await this.#repository.findTokenSourceKindByTokenHash(tokenHash)) !== null) {
        throw new ShareNoLongerAvailableError();
      }
      throw new InvitationNotFoundError();
    }

    const { invitation: record } = invitation;
    const userId = currentUser.id;

    const { scope, project, scan } = this.#entityOf(invitation);

    if (record.status === 'REVOKED') {
      throw new ShareNoLongerAvailableError();
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
    const ownerId = scope === 'project' ? project?.owner.id : scan?.ownerId;
    if (ownerId === userId) {
      throw new CannotAcceptOwnInvitationError();
    }
    this.#assertRecipientMatch(record.recipientEmail, currentUser);
    const entityId = scope === 'project' ? project?.id : scan?.id;
    if (entityId !== undefined && (await this.#hasActiveAccess(scope, entityId, userId))) {
      throw new AccessAlreadyExistsError();
    }

    const now = this.#clock();
    const updated = await this.#repository.declineInvitation(record.id, now);

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

    await this.#requireOwnerOfInvitation(record, userId);

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

    await this.#requireOwnerOfInvitation(record, userId);

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

    const scope = this.#scopeOf(updated);
    const invitationUrl = this.#inviteUrl(rawToken, scope);

    if (scope === 'project') {
      if (updated.projectId === null) {
        throw new InvitationNotFoundError();
      }
      const info = await this.#repository.findProjectInfo(updated.projectId);
      if (info === null) {
        throw new ProjectNotFoundError();
      }
      await this.#sendInvitationEmail({
        scope: 'project',
        recipientEmail: updated.recipientEmail,
        ownerDisplay: info.ownerEmail ?? 'the project owner',
        entityName: info.name,
        invitationUrl,
        expiresInSeconds: this.#invitationTtlSeconds,
      });
    } else {
      if (updated.scanId === null) {
        throw new InvitationNotFoundError();
      }
      const info = await this.#repository.findScanInfo(updated.scanId);
      if (info === null) {
        throw new ScanNotFoundError();
      }
      await this.#sendInvitationEmail({
        scope: 'scan',
        recipientEmail: updated.recipientEmail,
        ownerDisplay: info.ownerEmail ?? 'the scan owner',
        entityName: info.name,
        invitationUrl,
        expiresInSeconds: this.#invitationTtlSeconds,
      });
    }

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
        revision: viewer.revision,
        recipientUser: viewer.user,
        grantedAt: viewer.grantedAt.toISOString(),
      })),
    };
  }

  async listScanShares(userId: string, scanId: string): Promise<SharesListResult> {
    const info = await this.#repository.findScanInfo(scanId);

    if (info === null) {
      throw new ScanNotFoundError();
    }
    if (info.ownerId !== userId) {
      throw new NotOwnerError();
    }

    const invitations = await this.#repository.listPendingByScan(scanId);
    const viewers = await this.#repository.listActiveScanViewers(scanId);
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
      revision: result.revision,
      revokedAt: result.revokedAt.toISOString(),
    };
  }

  async revokeScanViewer(
    userId: string,
    scanId: string,
    targetUserId: string,
  ): Promise<{ scanId: string; userId: string; revokedAt: string }> {
    const info = await this.#repository.findScanInfo(scanId);

    if (info === null) {
      throw new ScanNotFoundError();
    }
    if (info.ownerId !== userId) {
      throw new NotOwnerError();
    }

    const result = await this.#repository.revokeScanViewerAccess(
      scanId,
      targetUserId,
      this.#clock(),
    );

    if (result === null) {
      throw new ViewerAccessNotFoundError();
    }

    return {
      scanId,
      userId: targetUserId,
      revokedAt: result.revokedAt.toISOString(),
    };
  }
}
