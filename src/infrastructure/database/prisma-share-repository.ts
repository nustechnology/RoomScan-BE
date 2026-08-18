import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import {
  AssetStatus,
  InvitationStatus,
  ProjectRole as PrismaProjectRole,
} from '../../generated/prisma/enums.js';
import {
  InvitationAlreadySentError,
  AccessAlreadyExistsError,
} from '../../modules/share/share.errors.js';
import type {
  InvitationCreateData,
  InvitationRecord,
  InvitationWithEntity,
  ShareLinkCreateData,
  ShareLinkRecord,
  ShareLinkResourceData,
  ShareLinkWithEntity,
  ShareProjectInfo,
  ShareRepository,
  ShareScanInfo,
} from '../../modules/share/share.types.js';

const invitationSelect = {
  id: true,
  projectId: true,
  scanId: true,
  createdById: true,
  recipientEmail: true,
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
  recipientEmail: string;
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
      },
    },
    scans: {
      where: {
        deletedAt: null,
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
      },
    },
    project: {
      select: {
        ownerId: true,
      },
    },
    _count: {
      select: {
        notes: true,
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

type ShareClient = Pick<
  PrismaClient,
  'invitation' | 'projectAccess' | 'scanAccess' | 'shareLink' | 'project' | 'scan' | '$transaction'
>;

export class PrismaShareRepository implements ShareRepository {
  readonly #client: ShareClient;

  constructor(client: ShareClient) {
    this.#client = client;
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

  async createInvitation(data: InvitationCreateData): Promise<InvitationRecord> {
    return await this.#client.$transaction(async (transaction) => {
      const scopeWhere =
        data.projectId !== undefined
          ? { projectId: data.projectId, scanId: null }
          : { scanId: data.scanId, projectId: null };

      await transaction.invitation.updateMany({
        where: {
          ...scopeWhere,
          recipientEmail: data.recipientEmail,
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
            createdById: data.createdById,
            recipientEmail: data.recipientEmail,
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
        project: shareProjectSummarySelect,
        scan: shareScanSummarySelect,
      },
    });

    if (row === null) {
      return null;
    }

    return {
      invitation: toInvitationRecord(row),
      project:
        row.project === null
          ? null
          : {
              id: row.project.id,
              name: row.project.name,
              description: row.project.description,
              thumbnail: row.project.scans[0]?.thumbnail ?? null,
              owner: row.project.owner,
              scanCount: row.project._count.scans,
            },
      scan:
        row.scan === null
          ? null
          : {
              id: row.scan.id,
              projectId: row.scan.projectId,
              name: row.scan.name,
              description: row.scan.description,
              thumbnail: row.scan.thumbnail,
              noteCount: row.scan._count.notes,
              creator: row.scan.creator,
              ownerId: row.scan.project.ownerId,
            },
    };
  }

  async findInvitationById(id: string): Promise<InvitationRecord | null> {
    const row = await this.#client.invitation.findUnique({
      where: { id },
      select: invitationSelect,
    });
    return row === null ? null : toInvitationRecord(row);
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

      await transaction.projectAccess.upsert({
        where: { projectId_userId: { projectId, userId } },
        create: {
          projectId,
          userId,
          role: PrismaProjectRole.VIEWER,
          invitationId,
          acceptedAt,
          revokedAt: null,
        },
        update: {
          role: PrismaProjectRole.VIEWER,
          invitationId,
          acceptedAt,
          revokedAt: null,
        },
      });

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
        },
        update: {
          role: PrismaProjectRole.VIEWER,
          invitationId,
          acceptedAt,
          revokedAt: null,
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

  async listPendingByProject(projectId: string): Promise<InvitationRecord[]> {
    const rows = await this.#client.invitation.findMany({
      where: { projectId, status: InvitationStatus.PENDING },
      orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
      select: invitationSelect,
    });
    return rows.map(toInvitationRecord);
  }

  async listPendingByScan(scanId: string): Promise<InvitationRecord[]> {
    const rows = await this.#client.invitation.findMany({
      where: { scanId, status: InvitationStatus.PENDING },
      orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
      select: invitationSelect,
    });
    return rows.map(toInvitationRecord);
  }

  async findActiveViewerAccess(projectId: string, userId: string): Promise<{ id: string } | null> {
    return await this.#client.projectAccess.findFirst({
      where: { projectId, userId, revokedAt: null },
      select: { id: true },
    });
  }

  async findActiveScanAccess(scanId: string, userId: string): Promise<{ id: string } | null> {
    return await this.#client.scanAccess.findFirst({
      where: { scanId, userId, revokedAt: null },
      select: { id: true },
    });
  }

  async listActiveViewers(
    projectId: string,
  ): Promise<
    Array<{ userId: string; user: { id: string; email: string | null }; grantedAt: Date }>
  > {
    const rows = await this.#client.projectAccess.findMany({
      where: { projectId, role: PrismaProjectRole.VIEWER, revokedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        userId: true,
        acceptedAt: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            email: true,
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

  async listActiveScanViewers(
    scanId: string,
  ): Promise<
    Array<{ userId: string; user: { id: string; email: string | null }; grantedAt: Date }>
  > {
    const rows = await this.#client.scanAccess.findMany({
      where: { scanId, role: PrismaProjectRole.VIEWER, revokedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        userId: true,
        acceptedAt: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            email: true,
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
  ): Promise<{ revokedAt: Date } | null> {
    const access = await this.#client.projectAccess.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { id: true, revokedAt: true },
    });

    if (access === null) {
      return null;
    }
    if (access.revokedAt !== null) {
      return { revokedAt: access.revokedAt };
    }

    const updated = await this.#client.projectAccess.update({
      where: { id: access.id },
      data: { revokedAt },
      select: { revokedAt: true },
    });
    return { revokedAt: updated.revokedAt as Date };
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
      project:
        row.project === null
          ? null
          : {
              id: row.project.id,
              name: row.project.name,
              description: row.project.description,
              thumbnail: row.project.scans[0]?.thumbnail ?? null,
              owner: row.project.owner,
              scanCount: row.project._count.scans,
            },
      scan:
        row.scan === null
          ? null
          : {
              id: row.scan.id,
              projectId: row.scan.projectId,
              name: row.scan.name,
              description: row.scan.description,
              thumbnail: row.scan.thumbnail,
              noteCount: row.scan._count.notes,
              creator: row.scan.creator,
              ownerId: row.scan.project.ownerId,
            },
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
    const existingRevoked = await this.#client.projectAccess.findFirst({
      where: { projectId, userId, revokedAt: { not: null } },
      select: { id: true },
    });

    if (existingRevoked !== null) {
      throw new AccessAlreadyExistsError();
    }

    const access = await this.#client.projectAccess.upsert({
      where: { projectId_userId: { projectId, userId } },
      create: {
        projectId,
        userId,
        role: PrismaProjectRole.VIEWER,
        shareLinkId,
        acceptedAt,
        revokedAt: null,
      },
      update: {
        role: PrismaProjectRole.VIEWER,
        shareLinkId,
        acceptedAt,
      },
      select: { id: true },
    });
    return { id: access.id };
  }

  async grantScanAccess(
    scanId: string,
    userId: string,
    shareLinkId: string,
    acceptedAt: Date,
  ): Promise<{ id: string }> {
    const existingRevoked = await this.#client.scanAccess.findFirst({
      where: { scanId, userId, revokedAt: { not: null } },
      select: { id: true },
    });

    if (existingRevoked !== null) {
      throw new AccessAlreadyExistsError();
    }

    const access = await this.#client.scanAccess.upsert({
      where: { scanId_userId: { scanId, userId } },
      create: {
        scanId,
        userId,
        role: PrismaProjectRole.VIEWER,
        shareLinkId,
        acceptedAt,
        revokedAt: null,
      },
      update: {
        role: PrismaProjectRole.VIEWER,
        shareLinkId,
        acceptedAt,
      },
      select: { id: true },
    });
    return { id: access.id };
  }
}
