import { ProjectNotFoundError } from '../project/project.errors.js';
import { ScanNotFoundError } from '../scan/scan.errors.js';
import {
  NotOwnerError,
  ProjectNotShareableError,
  ScanNotShareableError,
  ShareLinkNotFoundError,
} from './share.errors.js';
import { generateInvitationToken, hashInvitationToken } from './share.service.js';
import type {
  ShareLinkCreateResult,
  ShareLinkListResult,
  ShareLinkRecord,
  ShareLinkRevokeResult,
  ShareRepository,
  ShareScope,
} from './share.types.js';

export interface ShareLinkServiceDependencies {
  repository: ShareRepository;
  clock?: () => Date;
  invitationTtlSeconds: number;
  invitationBaseUrl: string;
}

export type ShareLinkResource = { projectId: string } | { scanId: string };

export class ShareLinkService {
  readonly #repository: ShareRepository;
  readonly #clock: () => Date;
  readonly #invitationTtlSeconds: number;
  readonly #invitationBaseUrl: string;

  constructor({
    repository,
    clock,
    invitationTtlSeconds,
    invitationBaseUrl,
  }: ShareLinkServiceDependencies) {
    this.#repository = repository;
    this.#clock = clock ?? (() => new Date());
    this.#invitationTtlSeconds = invitationTtlSeconds;
    this.#invitationBaseUrl = invitationBaseUrl;
  }

  #scopeOf(resource: ShareLinkResource): ShareScope {
    return 'projectId' in resource ? 'project' : 'scan';
  }

  async #requireOwner(resource: ShareLinkResource, userId: string): Promise<void> {
    if ('projectId' in resource) {
      const ownerId = await this.#repository.findProjectOwner(resource.projectId);

      if (ownerId === null) {
        throw new ProjectNotFoundError();
      }
      if (ownerId !== userId) {
        throw new NotOwnerError();
      }
      return;
    }

    const info = await this.#repository.findScanInfo(resource.scanId);

    if (info === null) {
      throw new ScanNotFoundError();
    }
    if (info.ownerId !== userId) {
      throw new NotOwnerError();
    }
  }

  async #requireShareable(resource: ShareLinkResource): Promise<void> {
    if ('projectId' in resource) {
      if (!(await this.#repository.hasUploadedModel(resource.projectId))) {
        throw new ProjectNotShareableError();
      }
      return;
    }
    if (!(await this.#repository.hasUploadedScanModel(resource.scanId))) {
      throw new ScanNotShareableError();
    }
  }

  async createShareLink(
    userId: string,
    resource: ShareLinkResource,
  ): Promise<ShareLinkCreateResult> {
    await this.#requireOwner(resource, userId);
    await this.#requireShareable(resource);

    const now = this.#clock();
    const expiresAt = new Date(now.getTime() + this.#invitationTtlSeconds * 1000);
    const rawToken = generateInvitationToken();
    const record = await this.#repository.createShareLink({
      createdById: userId,
      ...resource,
      tokenHash: hashInvitationToken(rawToken),
      expiresAt,
    });

    return {
      shareLinkId: record.id,
      shareLinkUrl: `${this.#invitationBaseUrl}/invitations/${rawToken}`,
      scope: this.#scopeOf(resource),
      expiresAt: expiresAt.toISOString(),
    };
  }

  async listShareLinks(
    userId: string,
    resource: ShareLinkResource,
  ): Promise<ShareLinkListResult[]> {
    await this.#requireOwner(resource, userId);

    const links = await this.#repository.listShareLinksByResource(resource);

    return links.map((link) => ({
      shareLinkId: link.id,
      status:
        link.expiresAt.getTime() <= this.#clock().getTime()
          ? ('EXPIRED' as const)
          : ('ACTIVE' as const),
      expiresAt: link.expiresAt.toISOString(),
      createdAt: link.createdAt.toISOString(),
    }));
  }

  async revokeShareLink(userId: string, shareLinkId: string): Promise<ShareLinkRevokeResult> {
    const record: ShareLinkRecord | null = await this.#repository.findShareLinkById(shareLinkId);

    if (record === null) {
      throw new ShareLinkNotFoundError();
    }

    if (record.projectId !== null) {
      await this.#requireOwner({ projectId: record.projectId }, userId);
    } else if (record.scanId !== null) {
      await this.#requireOwner({ scanId: record.scanId }, userId);
    } else {
      throw new ShareLinkNotFoundError();
    }

    if (record.revokedAt !== null) {
      return {
        shareLinkId: record.id,
        status: 'REVOKED',
        revokedAt: record.revokedAt.toISOString(),
      };
    }

    const now = this.#clock();
    const updated = await this.#repository.revokeShareLink(shareLinkId, now);

    if (updated === null) {
      const reread = await this.#repository.findShareLinkById(shareLinkId);
      if (reread !== null && reread.revokedAt !== null) {
        return {
          shareLinkId: reread.id,
          status: 'REVOKED',
          revokedAt: reread.revokedAt.toISOString(),
        };
      }
      throw new ShareLinkNotFoundError();
    }

    return {
      shareLinkId,
      status: 'REVOKED',
      revokedAt: now.toISOString(),
    };
  }
}
