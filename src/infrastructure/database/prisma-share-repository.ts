import type { PrismaClient } from '../../generated/prisma/client.js';
import {
  AssetStatus,
  InvitationStatus,
  ProjectRole as PrismaProjectRole,
} from '../../generated/prisma/enums.js';
import type {
  InvitationRecord,
  InvitationWithProject,
  ShareRepository,
} from '../../modules/share/share.types.js';

const invitationSelect = {
  id: true,
  projectId: true,
  createdById: true,
  tokenHash: true,
  status: true,
  expiresAt: true,
  sentAt: true,
  revokedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

interface InvitationRow {
  id: string;
  projectId: string;
  createdById: string;
  tokenHash: string;
  status: 'PENDING' | 'REVOKED';
  expiresAt: Date;
  sentAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toInvitationRecord(row: InvitationRow): InvitationRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    createdById: row.createdById,
    tokenHash: row.tokenHash,
    status: row.status,
    expiresAt: row.expiresAt,
    sentAt: row.sentAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaShareRepository implements ShareRepository {
  readonly #client: Pick<PrismaClient, 'invitation' | 'projectAccess' | 'project' | 'scan'>;

  constructor(client: Pick<PrismaClient, 'invitation' | 'projectAccess' | 'project' | 'scan'>) {
    this.#client = client;
  }

  async findProjectOwner(projectId: string): Promise<string | null> {
    const project = await this.#client.project.findFirst({
      where: { id: projectId, deletedAt: null },
      select: { ownerId: true },
    });
    return project?.ownerId ?? null;
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
    tokenHash: string;
    expiresAt: Date;
    sentAt: Date;
  }): Promise<InvitationRecord> {
    const row = await this.#client.invitation.create({
      data: {
        projectId: data.projectId,
        createdById: data.createdById,
        tokenHash: data.tokenHash,
        status: InvitationStatus.PENDING,
        expiresAt: data.expiresAt,
        sentAt: data.sentAt,
      },
      select: invitationSelect,
    });
    return toInvitationRecord(row);
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

  async revokeInvitation(id: string, revokedAt: Date): Promise<InvitationRecord | null> {
    const row = await this.#client.invitation.update({
      where: { id },
      data: {
        status: InvitationStatus.REVOKED,
        revokedAt,
      },
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

  async findDeclinedAccess(
    projectId: string,
    userId: string,
    invitationId: string,
  ): Promise<{ id: string } | null> {
    return await this.#client.projectAccess.findFirst({
      where: {
        projectId,
        userId,
        invitationId,
        declinedAt: { not: null },
      },
      select: { id: true },
    });
  }

  async acceptInvitation(
    projectId: string,
    userId: string,
    invitationId: string,
    acceptedAt: Date,
  ): Promise<void> {
    await this.#client.projectAccess.upsert({
      where: { projectId_userId: { projectId, userId } },
      create: {
        projectId,
        userId,
        role: PrismaProjectRole.VIEWER,
        invitationId,
        acceptedAt,
        declinedAt: null,
        revokedAt: null,
      },
      update: {
        role: PrismaProjectRole.VIEWER,
        invitationId,
        acceptedAt,
        declinedAt: null,
        revokedAt: null,
      },
    });
  }

  async declineInvitation(
    projectId: string,
    userId: string,
    invitationId: string,
    declinedAt: Date,
  ): Promise<void> {
    await this.#client.projectAccess.upsert({
      where: { projectId_userId: { projectId, userId } },
      create: {
        projectId,
        userId,
        role: PrismaProjectRole.VIEWER,
        invitationId,
        acceptedAt: null,
        declinedAt,
        revokedAt: declinedAt,
      },
      update: {
        invitationId,
        acceptedAt: null,
        declinedAt,
        revokedAt: declinedAt,
      },
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
