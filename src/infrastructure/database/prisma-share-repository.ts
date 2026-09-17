import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import {
  AssetStatus,
  InvitationStatus,
  ProjectRole as PrismaProjectRole,
} from '../../generated/prisma/enums.js';
import type {
  IdempotencyContext,
  IdempotencyResult,
} from '../../common/idempotency/idempotency.types.js';
import { InvitationAlreadySentError } from '../../modules/share/share.errors.js';
import type {
  InvitationCreateData,
  InvitationRecipientData,
  InvitationRecord,
  InvitationCreateResult,
  InvitationWithEntity,
  PendingInvitationRow,
  ShareLinkCreateData,
  ShareLinkRecord,
  ShareLinkResourceData,
  ShareLinkWithEntity,
  ShareProjectInfo,
  ShareProjectSummary,
  ShareRecipientUser,
  ShareRepository,
  ShareScanInfo,
  ShareScanSummary,
  ShareUserSummary,
} from '../../modules/share/share.types.js';
import { toSkipTake, type PaginationParams } from '../../common/pagination/pagination.js';
import type { PrismaIdempotencyExecutor } from './prisma-idempotency.js';
import {
  refreshProjectRollup,
  writeAccessUpsert,
  writeDeleteChange,
  writeProjectBootstrap,
} from './prisma-sync-writer.js';

const invitationSelect = {
  id: true,
  projectId: true,
  scanId: true,
  createdById: true,
  recipientEmail: true,
  recipientUserId: true,
  tokenHash: true,
  status: true,
  expiresAt: true,
  sentAt: true,
  acceptedAt: true,
  acceptedByUserId: true,
  declinedAt: true,
  revokedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

interface InvitationRow {
  id: string;
  projectId: string | null;
  scanId: string | null;
  createdById: string;
  recipientEmail: string | null;
  recipientUserId: string | null;
  tokenHash: string;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'REVOKED';
  expiresAt: Date;
  sentAt: Date;
  acceptedAt: Date | null;
  acceptedByUserId: string | null;
  declinedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const shareLinkSelect = {
  id: true,
  projectId: true,
  scanId: true,
  createdById: true,
  tokenHash: true,
  expiresAt: true,
  revokedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const shareProjectSummarySelect = {
  select: {
    id: true,
    name: true,
    description: true,
    owner: {
      select: {
        id: true,
        email: true,
        displayName: true,
      },
    },
    scans: {
      where: {
        deletedAt: null,
        assetStatus: AssetStatus.UPLOADED,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 1,
      select: {
        thumbnail: true,
      },
    },
    _count: {
      select: {
        scans: {
          where: {
            deletedAt: null,
            assetStatus: AssetStatus.UPLOADED,
          },
        },
      },
    },
  },
} as const;

const shareScanSummarySelect = {
  select: {
    id: true,
    projectId: true,
    name: true,
    description: true,
    thumbnail: true,
    creator: {
      select: {
        id: true,
        email: true,
        displayName: true,
      },
    },
    project: {
      select: {
        ownerId: true,
      },
    },
    _count: {
      select: {
        notes: { where: { deletedAt: null } },
      },
    },
  },
} as const;

interface ShareLinkRow {
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

function toInvitationRecord(row: InvitationRow): InvitationRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    scanId: row.scanId,
    createdById: row.createdById,
    recipientEmail: row.recipientEmail,
    recipientUserId: row.recipientUserId,
    tokenHash: row.tokenHash,
    status: row.status,
    expiresAt: row.expiresAt,
    sentAt: row.sentAt,
    acceptedAt: row.acceptedAt,
    acceptedByUserId: row.acceptedByUserId,
    declinedAt: row.declinedAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toShareLinkRecord(row: ShareLinkRow): ShareLinkRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    scanId: row.scanId,
    createdById: row.createdById,
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const recipientUserSelect = {
  select: {
    id: true,
    publicId: true,
    email: true,
    displayName: true,
  },
} as const;

const creatorUserSelect = {
  select: {
    id: true,
    email: true,
    displayName: true,
  },
} as const;

interface RecipientUserRow {
  id: string;
  publicId: string;
  email: string | null;
  displayName: string | null;
}

function toRecipientUser(row: RecipientUserRow | null | undefined): ShareRecipientUser | null {
  return row === null || row === undefined
    ? null
    : { id: row.id, publicUserId: row.publicId, email: row.email, displayName: row.displayName };
}

interface ProjectSummaryRow {
  id: string;
  name: string;
  description: string | null;
  owner: ShareUserSummary;
  scans: Array<{ thumbnail: string | null }>;
  _count: { scans: number };
}

interface ScanSummaryRow {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  thumbnail: string | null;
  creator: ShareUserSummary;
  project: { ownerId: string };
  _count: { notes: number };
}

function toProjectSummary(row: ProjectSummaryRow | null): ShareProjectSummary | null {
  return row === null
    ? null
    : {
        id: row.id,
        name: row.name,
        description: row.description,
        thumbnail: row.scans[0]?.thumbnail ?? null,
        owner: row.owner,
        scanCount: row._count.scans,
      };
}

function toScanSummary(row: ScanSummaryRow | null): ShareScanSummary | null {
  return row === null
    ? null
    : {
        id: row.id,
        projectId: row.projectId,
        name: row.name,
        description: row.description,
        thumbnail: row.thumbnail,
        noteCount: row._count.notes,
        creator: row.creator,
        ownerId: row.project.ownerId,
      };
}

function toInvitationWithEntity(
  row: InvitationRow & {
    recipient: RecipientUserRow | null;
    creator: ShareUserSummary;
    project: ProjectSummaryRow | null;
    scan: ScanSummaryRow | null;
  },
): InvitationWithEntity {
  return {
    invitation: toInvitationRecord(row),
    recipient: toRecipientUser(row.recipient),
    creator: row.creator,
    project: toProjectSummary(row.project),
    scan: toScanSummary(row.scan),
  };
}

/** Matches the recipient binding an invitation stores; exactly one is set. */
function recipientWhere(data: InvitationRecipientData): {
  recipientEmail: string | null;
  recipientUserId: string | null;
} {
  return data.recipientEmail !== undefined
    ? { recipientEmail: data.recipientEmail, recipientUserId: null }
    : { recipientEmail: null, recipientUserId: data.recipientUserId };
}

type ShareClient = Pick<
  PrismaClient,
  | 'invitation'
  | 'projectAccess'
  | 'scanAccess'
  | 'shareLink'
  | 'project'
  | 'scan'
  | 'user'
  | '$transaction'
>;

export class PrismaShareRepository implements ShareRepository {
  readonly #client: ShareClient;
  readonly #idempotency: PrismaIdempotencyExecutor | undefined;

  constructor(client: ShareClient, idempotency?: PrismaIdempotencyExecutor) {
    this.#client = client;
    this.#idempotency = idempotency;
  }

  async findProjectOwner(projectId: string): Promise<string | null> {
    const project = await this.#client.project.findFirst({
      where: { id: projectId, deletedAt: null },
      select: { ownerId: true },
    });
    return project?.ownerId ?? null;
  }

  async findProjectInfo(projectId: string): Promise<ShareProjectInfo | null> {
    const project = await this.#client.project.findFirst({
      where: { id: projectId, deletedAt: null },
      select: {
        name: true,
        ownerId: true,
        owner: {
          select: {
            email: true,
          },
        },
      },
    });

    if (project === null) {
      return null;
    }

    return {
      name: project.name,
      ownerId: project.ownerId,
      ownerEmail: project.owner.email,
    };
  }

  async hasUploadedModel(projectId: string): Promise<boolean> {
    const scan = await this.#client.scan.findFirst({
      where: {
        projectId,
        deletedAt: null,
        assetStatus: AssetStatus.UPLOADED,
      },
      select: { id: true },
    });
    return scan !== null;
  }

  async findScanInfo(scanId: string): Promise<ShareScanInfo | null> {
    const scan = await this.#client.scan.findFirst({
      where: { id: scanId, deletedAt: null, project: { deletedAt: null } },
      select: {
        name: true,
        projectId: true,
        project: {
          select: {
            ownerId: true,
            owner: {
              select: {
                email: true,
              },
            },
          },
        },
      },
    });

    if (scan === null) {
      return null;
    }

    return {
      name: scan.name,
      projectId: scan.projectId,
      ownerId: scan.project.ownerId,
      ownerEmail: scan.project.owner.email,
    };
  }

  async hasUploadedScanModel(scanId: string): Promise<boolean> {
    const scan = await this.#client.scan.findFirst({
      where: {
        id: scanId,
        deletedAt: null,
        assetStatus: AssetStatus.UPLOADED,
      },
      select: { id: true },
    });
    return scan !== null;
  }

  async expirePendingInvitations(now: Date): Promise<number> {
    const result = await this.#client.invitation.updateMany({
      where: {
        status: InvitationStatus.PENDING,
        expiresAt: { lte: now },
      },
      data: {
        status: InvitationStatus.REVOKED,
        revokedAt: now,
      },
    });
    return result.count;
  }

  async createInvitation(data: InvitationCreateData): Promise<InvitationRecord> {
    return await this.#client.$transaction(async (transaction) => {
      const scopeWhere =
        data.projectId !== undefined
          ? { projectId: data.projectId, scanId: null }
          : { scanId: data.scanId, projectId: null };
      const recipient = recipientWhere(data);

      await transaction.invitation.updateMany({
        where: {
          ...scopeWhere,
          ...recipient,
          status: InvitationStatus.PENDING,
          expiresAt: { lte: data.sentAt },
        },
        data: {
          status: InvitationStatus.REVOKED,
          revokedAt: data.sentAt,
        },
      });

      try {
        const row = await transaction.invitation.create({
          data: {
            ...scopeWhere,
            ...recipient,
            createdById: data.createdById,
            tokenHash: data.tokenHash,
            status: InvitationStatus.PENDING,
            expiresAt: data.expiresAt,
            sentAt: data.sentAt,
          },
          select: invitationSelect,
        });
        return toInvitationRecord(row);
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new InvitationAlreadySentError();
        }
        throw error;
      }
    });
  }

  async createInvitationIdempotently(
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
  ): Promise<IdempotencyResult<InvitationCreateResult>> {
    if (this.#idempotency === undefined)
      throw new Error('Invitation idempotency is not configured');
    const recipient = recipientWhere(data);
    return await this.#idempotency.execute(context, 201, async (transaction) => {
      await transaction.invitation.updateMany({
        where: {
          projectId: data.projectId,
          ...recipient,
          status: InvitationStatus.PENDING,
          expiresAt: { lte: data.sentAt },
        },
        data: { status: InvitationStatus.REVOKED, revokedAt: data.sentAt },
      });
      try {
        await transaction.invitation.create({
          data: {
            id: data.id,
            projectId: data.projectId,
            createdById: data.createdById,
            ...recipient,
            tokenHash: data.tokenHash,
            status: InvitationStatus.PENDING,
            expiresAt: data.expiresAt,
            sentAt: data.sentAt,
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new InvitationAlreadySentError();
        }
        throw error;
      }
      await refreshProjectRollup(transaction, data.projectId, data.sentAt);
      return result;
    });
  }

  async findByTokenHash(tokenHash: string): Promise<InvitationWithEntity | null> {
    const row = await this.#client.invitation.findFirst({
      where: {
        tokenHash,
        OR: [
          { projectId: { not: null }, project: { deletedAt: null } },
          { scanId: { not: null }, scan: { deletedAt: null, project: { deletedAt: null } } },
        ],
      },
      select: {
        ...invitationSelect,
        recipient: recipientUserSelect,
        creator: creatorUserSelect,
        project: shareProjectSummarySelect,
        scan: shareScanSummarySelect,
      },
    });

    if (row === null) {
      return null;
    }

    return toInvitationWithEntity(row);
  }

  async findInvitationById(id: string): Promise<InvitationRecord | null> {
    const row = await this.#client.invitation.findUnique({
      where: { id },
      select: invitationSelect,
    });
    return row === null ? null : toInvitationRecord(row);
  }

  async findTokenSourceKindByTokenHash(
    tokenHash: string,
  ): Promise<'invitation' | 'share-link' | null> {
    const invitation = await this.#client.invitation.findFirst({
      where: {
        tokenHash,
        OR: [
          { projectId: { not: null }, project: { deletedAt: { not: null } } },
          {
            scanId: { not: null },
            scan: {
              OR: [{ deletedAt: { not: null } }, { project: { deletedAt: { not: null } } }],
            },
          },
        ],
      },
      select: { id: true },
    });
    if (invitation !== null) {
      return 'invitation';
    }

    const shareLink = await this.#client.shareLink.findFirst({
      where: {
        tokenHash,
        OR: [
          { projectId: { not: null }, project: { deletedAt: { not: null } } },
          {
            scanId: { not: null },
            scan: {
              OR: [{ deletedAt: { not: null } }, { project: { deletedAt: { not: null } } }],
            },
          },
        ],
      },
      select: { id: true },
    });
    if (shareLink !== null) {
      return 'share-link';
    }

    return null;
  }

  async acceptInvitation(
    invitationId: string,
    projectId: string,
    userId: string,
    acceptedAt: Date,
  ): Promise<InvitationRecord | null> {
    return await this.#client.$transaction(async (transaction) => {
      const updated = await transaction.invitation.updateMany({
        where: {
          id: invitationId,
          projectId,
          status: InvitationStatus.PENDING,
          expiresAt: { gt: acceptedAt },
        },
        data: {
          status: InvitationStatus.ACCEPTED,
          acceptedAt,
          acceptedByUserId: userId,
        },
      });

      if (updated.count === 0) {
        return null;
      }

      const access = await transaction.projectAccess.upsert({
        where: { projectId_userId: { projectId, userId } },
        create: {
          projectId,
          userId,
          role: PrismaProjectRole.VIEWER,
          invitationId,
          acceptedAt,
          revokedAt: null,
          deletedAt: null,
        },
        update: {
          role: PrismaProjectRole.VIEWER,
          invitationId,
          acceptedAt,
          revokedAt: null,
          deletedAt: null,
          revision: { increment: 1 },
          updatedAt: acceptedAt,
        },
        select: { id: true },
      });

      await refreshProjectRollup(transaction, projectId, acceptedAt);
      await writeAccessUpsert(transaction, access.id, { changedAt: acceptedAt });
      await writeAccessUpsert(transaction, access.id, {
        targetUserId: userId,
        changedAt: acceptedAt,
      });
      await writeProjectBootstrap(transaction, projectId, userId, acceptedAt);

      const row = await transaction.invitation.findUnique({
        where: { id: invitationId },
        select: invitationSelect,
      });
      return row === null ? null : toInvitationRecord(row);
    });
  }

  async acceptScanInvitation(
    invitationId: string,
    scanId: string,
    userId: string,
    acceptedAt: Date,
  ): Promise<InvitationRecord | null> {
    return await this.#client.$transaction(async (transaction) => {
      const updated = await transaction.invitation.updateMany({
        where: {
          id: invitationId,
          scanId,
          status: InvitationStatus.PENDING,
          expiresAt: { gt: acceptedAt },
        },
        data: {
          status: InvitationStatus.ACCEPTED,
          acceptedAt,
          acceptedByUserId: userId,
        },
      });

      if (updated.count === 0) {
        return null;
      }

      await transaction.scanAccess.upsert({
        where: { scanId_userId: { scanId, userId } },
        create: {
          scanId,
          userId,
          role: PrismaProjectRole.VIEWER,
          invitationId,
          acceptedAt,
          revokedAt: null,
          deletedAt: null,
        },
        update: {
          role: PrismaProjectRole.VIEWER,
          invitationId,
          acceptedAt,
          revokedAt: null,
          deletedAt: null,
        },
      });

      const row = await transaction.invitation.findUnique({
        where: { id: invitationId },
        select: invitationSelect,
      });
      return row === null ? null : toInvitationRecord(row);
    });
  }

  async declineInvitation(
    invitationId: string,
    declinedAt: Date,
  ): Promise<InvitationRecord | null> {
    const updated = await this.#client.invitation.updateMany({
      where: { id: invitationId, status: InvitationStatus.PENDING },
      data: {
        status: InvitationStatus.DECLINED,
        declinedAt,
      },
    });

    if (updated.count === 0) {
      return null;
    }

    const row = await this.#client.invitation.findUnique({
      where: { id: invitationId },
      select: invitationSelect,
    });
    return row === null ? null : toInvitationRecord(row);
  }

  async revokeInvitation(id: string, revokedAt: Date): Promise<InvitationRecord | null> {
    const updated = await this.#client.invitation.updateMany({
      where: { id, status: InvitationStatus.PENDING },
      data: {
        status: InvitationStatus.REVOKED,
        revokedAt,
      },
    });

    if (updated.count === 0) {
      return null;
    }

    const row = await this.#client.invitation.findUnique({
      where: { id },
      select: invitationSelect,
    });
    return row === null ? null : toInvitationRecord(row);
  }

  async resendInvitation(
    id: string,
    data: { tokenHash: string; sentAt: Date; expiresAt: Date },
  ): Promise<InvitationRecord | null> {
    const updated = await this.#client.invitation.updateMany({
      where: { id, status: InvitationStatus.PENDING },
      data: {
        tokenHash: data.tokenHash,
        sentAt: data.sentAt,
        expiresAt: data.expiresAt,
      },
    });

    if (updated.count === 0) {
      return null;
    }

    const row = await this.#client.invitation.findUnique({
      where: { id },
      select: invitationSelect,
    });
    return row === null ? null : toInvitationRecord(row);
  }

  async listPendingByProject(projectId: string): Promise<PendingInvitationRow[]> {
    const rows = await this.#client.invitation.findMany({
      where: { projectId, status: InvitationStatus.PENDING },
      orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
      select: { ...invitationSelect, recipient: recipientUserSelect },
    });
    return rows.map((row) => ({
      invitation: toInvitationRecord(row),
      recipient: toRecipientUser(row.recipient),
    }));
  }

  async listPendingByScan(scanId: string): Promise<PendingInvitationRow[]> {
    const rows = await this.#client.invitation.findMany({
      where: { scanId, status: InvitationStatus.PENDING },
      orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
      select: { ...invitationSelect, recipient: recipientUserSelect },
    });
    return rows.map((row) => ({
      invitation: toInvitationRecord(row),
      recipient: toRecipientUser(row.recipient),
    }));
  }

  async findUserByPublicId(publicUserId: string): Promise<ShareRecipientUser | null> {
    const row = await this.#client.user.findUnique({
      where: { publicId: publicUserId },
      select: recipientUserSelect.select,
    });
    return toRecipientUser(row);
  }

  async findUserById(userId: string): Promise<ShareRecipientUser | null> {
    const row = await this.#client.user.findUnique({
      where: { id: userId },
      select: recipientUserSelect.select,
    });
    return toRecipientUser(row);
  }

  async findInvitationForRecipient(
    invitationId: string,
    userId: string,
  ): Promise<InvitationWithEntity | null> {
    const row = await this.#client.invitation.findFirst({
      where: {
        id: invitationId,
        recipientUserId: userId,
        OR: [
          { projectId: { not: null }, project: { deletedAt: null } },
          { scanId: { not: null }, scan: { deletedAt: null, project: { deletedAt: null } } },
        ],
      },
      select: {
        ...invitationSelect,
        recipient: recipientUserSelect,
        creator: creatorUserSelect,
        project: shareProjectSummarySelect,
        scan: shareScanSummarySelect,
      },
    });
    return row === null ? null : toInvitationWithEntity(row);
  }

  async listReceivedInvitations(
    userId: string,
    pagination: PaginationParams,
  ): Promise<{ items: InvitationWithEntity[]; total: number }> {
    const where = {
      recipientUserId: userId,
      status: InvitationStatus.PENDING,
      OR: [
        { projectId: { not: null }, project: { deletedAt: null } },
        { scanId: { not: null }, scan: { deletedAt: null, project: { deletedAt: null } } },
      ],
    };
    const { skip, take } = toSkipTake(pagination);
    const [rows, total] = await this.#client.$transaction([
      this.#client.invitation.findMany({
        where,
        orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
        select: {
          ...invitationSelect,
          recipient: recipientUserSelect,
          creator: creatorUserSelect,
          project: shareProjectSummarySelect,
          scan: shareScanSummarySelect,
        },
      }),
      this.#client.invitation.count({ where }),
    ]);
    return { items: rows.map(toInvitationWithEntity), total };
  }

  async findActiveViewerAccess(projectId: string, userId: string): Promise<{ id: string } | null> {
    return await this.#client.projectAccess.findFirst({
      where: { projectId, userId, revokedAt: null, deletedAt: null },
      select: { id: true },
    });
  }

  async findActiveScanAccess(scanId: string, userId: string): Promise<{ id: string } | null> {
    return await this.#client.scanAccess.findFirst({
      where: { scanId, userId, revokedAt: null, deletedAt: null },
      select: { id: true },
    });
  }

  async listActiveViewers(projectId: string): Promise<
    Array<{
      userId: string;
      revision: number;
      user: { id: string; email: string | null; displayName: string | null };
      grantedAt: Date;
    }>
  > {
    const rows = await this.#client.projectAccess.findMany({
      where: { projectId, role: PrismaProjectRole.VIEWER, revokedAt: null, deletedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        userId: true,
        revision: true,
        acceptedAt: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
          },
        },
      },
    });

    return rows.map((row) => ({
      userId: row.userId,
      revision: row.revision,
      user: row.user,
      grantedAt: row.acceptedAt ?? row.createdAt,
    }));
  }

  async listActiveScanViewers(scanId: string): Promise<
    Array<{
      userId: string;
      user: { id: string; email: string | null; displayName: string | null };
      grantedAt: Date;
    }>
  > {
    const rows = await this.#client.scanAccess.findMany({
      where: { scanId, role: PrismaProjectRole.VIEWER, revokedAt: null, deletedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        userId: true,
        acceptedAt: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
          },
        },
      },
    });

    return rows.map((row) => ({
      userId: row.userId,
      user: row.user,
      grantedAt: row.acceptedAt ?? row.createdAt,
    }));
  }

  async revokeViewerAccess(
    projectId: string,
    userId: string,
    revokedAt: Date,
  ): Promise<{ revokedAt: Date; revision: number } | null> {
    if (this.#idempotency === undefined) {
      const access = await this.#client.projectAccess.findUnique({
        where: { projectId_userId: { projectId, userId } },
        select: { id: true, revision: true, revokedAt: true },
      });
      if (access === null) return null;
      if (access.revokedAt !== null) {
        return { revokedAt: access.revokedAt, revision: access.revision };
      }
      const updated = await this.#client.projectAccess.update({
        where: { id: access.id },
        data: { revokedAt, revision: { increment: 1 }, updatedAt: revokedAt },
        select: { revokedAt: true, revision: true },
      });
      return { revokedAt: updated.revokedAt as Date, revision: updated.revision };
    }
    return await this.#client.$transaction(async (transaction) => {
      const access = await transaction.projectAccess.findUnique({
        where: { projectId_userId: { projectId, userId } },
        select: {
          id: true,
          revision: true,
          revokedAt: true,
          project: { select: { ownerId: true } },
        },
      });
      if (access === null) return null;
      if (access.revokedAt !== null) {
        return { revokedAt: access.revokedAt, revision: access.revision };
      }

      const claimed = await transaction.projectAccess.updateMany({
        where: { id: access.id, revokedAt: null },
        data: { revokedAt, revision: { increment: 1 }, updatedAt: revokedAt },
      });
      if (claimed.count === 0) {
        const current = await transaction.projectAccess.findUnique({
          where: { projectId_userId: { projectId, userId } },
          select: { revision: true, revokedAt: true },
        });
        return current === null
          ? null
          : { revokedAt: current.revokedAt as Date, revision: current.revision };
      }
      const updated = await transaction.projectAccess.findUnique({
        where: { id: access.id },
        select: { revision: true },
      });
      const storedRevision = updated?.revision ?? access.revision + 1;
      const change = {
        projectId,
        ownerId: access.project.ownerId,
        resourceType: 'PROJECT_ACCESS' as const,
        resourceId: access.id,
        revision: storedRevision,
        deletedAt: revokedAt,
      };
      await writeDeleteChange(transaction, change);
      await writeDeleteChange(transaction, { ...change, targetUserId: userId });
      await refreshProjectRollup(transaction, projectId, revokedAt);
      return { revokedAt, revision: storedRevision };
    });
  }

  async revokeScanViewerAccess(
    scanId: string,
    userId: string,
    revokedAt: Date,
  ): Promise<{ revokedAt: Date } | null> {
    const access = await this.#client.scanAccess.findUnique({
      where: { scanId_userId: { scanId, userId } },
      select: { id: true, revokedAt: true },
    });

    if (access === null) {
      return null;
    }
    if (access.revokedAt !== null) {
      return { revokedAt: access.revokedAt };
    }

    const updated = await this.#client.scanAccess.update({
      where: { id: access.id },
      data: { revokedAt },
      select: { revokedAt: true },
    });
    return { revokedAt: updated.revokedAt as Date };
  }

  async createShareLink(data: ShareLinkCreateData): Promise<ShareLinkRecord> {
    const row = await this.#client.shareLink.create({
      data: {
        createdById: data.createdById,
        tokenHash: data.tokenHash,
        expiresAt: data.expiresAt,
        ...(data.projectId !== undefined ? { projectId: data.projectId } : { scanId: data.scanId }),
      },
      select: shareLinkSelect,
    });
    return toShareLinkRecord(row);
  }

  async findShareLinkByTokenHash(tokenHash: string): Promise<ShareLinkWithEntity | null> {
    const row = await this.#client.shareLink.findFirst({
      where: {
        tokenHash,
        OR: [
          { projectId: { not: null }, project: { deletedAt: null } },
          { scanId: { not: null }, scan: { deletedAt: null, project: { deletedAt: null } } },
        ],
      },
      select: {
        ...shareLinkSelect,
        project: shareProjectSummarySelect,
        scan: shareScanSummarySelect,
      },
    });

    if (row === null) {
      return null;
    }

    return {
      shareLink: toShareLinkRecord(row),
      project: toProjectSummary(row.project),
      scan: toScanSummary(row.scan),
    };
  }

  async findShareLinkById(id: string): Promise<ShareLinkRecord | null> {
    const row = await this.#client.shareLink.findUnique({
      where: { id },
      select: shareLinkSelect,
    });
    return row === null ? null : toShareLinkRecord(row);
  }

  async listShareLinksByResource(data: ShareLinkResourceData): Promise<ShareLinkRecord[]> {
    const rows = await this.#client.shareLink.findMany({
      where: {
        revokedAt: null,
        ...(data.projectId !== undefined
          ? { projectId: data.projectId, scanId: null }
          : { scanId: data.scanId, projectId: null }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: shareLinkSelect,
    });
    return rows.map(toShareLinkRecord);
  }

  async revokeShareLink(id: string, revokedAt: Date): Promise<ShareLinkRecord | null> {
    const updated = await this.#client.shareLink.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt },
    });

    if (updated.count === 0) {
      return null;
    }

    const row = await this.#client.shareLink.findUnique({
      where: { id },
      select: shareLinkSelect,
    });
    return row === null ? null : toShareLinkRecord(row);
  }

  async grantProjectAccess(
    projectId: string,
    userId: string,
    shareLinkId: string,
    acceptedAt: Date,
  ): Promise<{ id: string }> {
    return await this.#client.$transaction(async (transaction) => {
      const access = await transaction.projectAccess.upsert({
        where: { projectId_userId: { projectId, userId } },
        create: {
          projectId,
          userId,
          role: PrismaProjectRole.VIEWER,
          shareLinkId,
          acceptedAt,
          revokedAt: null,
          deletedAt: null,
        },
        update: {
          role: PrismaProjectRole.VIEWER,
          shareLinkId,
          acceptedAt,
          revokedAt: null,
          deletedAt: null,
          revision: { increment: 1 },
          updatedAt: acceptedAt,
        },
        select: { id: true },
      });

      await writeAccessUpsert(transaction, access.id, { changedAt: acceptedAt });
      await writeAccessUpsert(transaction, access.id, {
        targetUserId: userId,
        changedAt: acceptedAt,
      });
      return { id: access.id };
    });
  }

  async grantScanAccess(
    scanId: string,
    userId: string,
    shareLinkId: string,
    acceptedAt: Date,
  ): Promise<{ id: string }> {
    const access = await this.#client.scanAccess.upsert({
      where: { scanId_userId: { scanId, userId } },
      create: {
        scanId,
        userId,
        role: PrismaProjectRole.VIEWER,
        shareLinkId,
        acceptedAt,
        revokedAt: null,
        deletedAt: null,
      },
      update: {
        role: PrismaProjectRole.VIEWER,
        shareLinkId,
        acceptedAt,
        revokedAt: null,
        deletedAt: null,
      },
      select: { id: true },
    });
    return { id: access.id };
  }
}
