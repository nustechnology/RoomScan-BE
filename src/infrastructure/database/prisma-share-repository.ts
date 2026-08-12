import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import {
  AssetStatus,
  InvitationStatus,
  ProjectRole as PrismaProjectRole,
} from '../../generated/prisma/enums.js';
import { InvitationAlreadySentError } from '../../modules/share/share.errors.js';
import type {
  InvitationRecord,
  InvitationWithProject,
  ShareProjectInfo,
  ShareRepository,
} from '../../modules/share/share.types.js';

const invitationSelect = {
  id: true,
  projectId: true,
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
  projectId: string;
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

function toInvitationRecord(row: InvitationRow): InvitationRecord {
  return {
    id: row.id,
    projectId: row.projectId,
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

type ShareClient = Pick<
  PrismaClient,
  'invitation' | 'projectAccess' | 'project' | 'scan' | '$transaction'
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

  async createInvitation(data: {
    projectId: string;
    createdById: string;
    recipientEmail: string;
    tokenHash: string;
    expiresAt: Date;
    sentAt: Date;
  }): Promise<InvitationRecord> {
    return await this.#client.$transaction(async (transaction) => {
      await transaction.invitation.updateMany({
        where: {
          projectId: data.projectId,
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
            projectId: data.projectId,
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

  async findByTokenHash(tokenHash: string): Promise<InvitationWithProject | null> {
    const row = await this.#client.invitation.findFirst({
      where: {
        tokenHash,
        project: { deletedAt: null },
      },
      select: {
        ...invitationSelect,
        project: {
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
          },
        },
      },
    });

    if (row === null) {
      return null;
    }

    return {
      invitation: toInvitationRecord(row),
      project: {
        id: row.project.id,
        name: row.project.name,
        description: row.project.description,
        thumbnail: null,
        owner: row.project.owner,
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

  async findActiveViewerAccess(projectId: string, userId: string): Promise<{ id: string } | null> {
    return await this.#client.projectAccess.findFirst({
      where: { projectId, userId, revokedAt: null },
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
}
