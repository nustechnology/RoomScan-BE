import { ProjectNotFoundError } from '../project/project.errors.js';
import { NotSharedProjectError, SharedProjectNotInListError } from './shared-projects.errors.js';
import type {
  SharedProjectDetailRecord,
  SharedProjectDetailResult,
  SharedProjectRecord,
  SharedProjectRemoveResult,
  SharedProjectResult,
  SharedProjectStatus,
  SharedProjectsListOptions,
  SharedProjectsListResult,
  SharedProjectsRepository,
} from './shared-projects.types.js';

export interface SharedProjectsServiceDependencies {
  repository: SharedProjectsRepository;
  clock?: () => Date;
}

export function sharedProjectStatus(record: SharedProjectRecord): SharedProjectStatus {
  if (record.projectDeletedAt !== null) {
    return record.accessRevokedAt === null ? 'TEMPORARILY_UNAVAILABLE' : 'PROJECT_DELETED';
  }
  if (record.accessRevokedAt !== null) {
    return 'REVOKED';
  }
  return 'ACTIVE';
}

function toResult(record: SharedProjectRecord): SharedProjectResult {
  const status = sharedProjectStatus(record);

  return {
    id: record.id,
    name: record.name,
    description: record.description,
    owner: record.owner,
    scanCount: record.scanCount,
    thumbnail: record.thumbnail,
    updatedAt: record.updatedAt.toISOString(),
    status,
    permissions: {
      role: 'VIEWER',
      canView: status === 'ACTIVE',
      canEdit: false,
      canDelete: false,
      canShare: false,
      canCreateScan: false,
    },
  };
}

function toDetailResult(record: SharedProjectDetailRecord): SharedProjectDetailResult {
  return {
    ...toResult(record),
    scans: record.scans.map((scan) => ({
      id: scan.id,
      name: scan.name,
      description: scan.description,
      thumbnail: scan.thumbnail,
      noteCount: scan.noteCount,
      assetStatus: scan.assetStatus,
      syncStatus: scan.syncStatus,
      createdAt: scan.createdAt.toISOString(),
    })),
  };
}

export class SharedProjectsService {
  readonly #repository: SharedProjectsRepository;
  readonly #clock: () => Date;

  constructor({ repository, clock }: SharedProjectsServiceDependencies) {
    this.#repository = repository;
    this.#clock = clock ?? (() => new Date());
  }

  async list(
    userId: string,
    options: SharedProjectsListOptions,
  ): Promise<SharedProjectsListResult> {
    const { items, total } = await this.#repository.list(userId, options);

    return {
      items: items.map(toResult),
      pagination: {
        page: options.page,
        limit: options.limit,
        total,
        totalPages: Math.ceil(total / options.limit),
      },
    };
  }

  async detail(userId: string, projectId: string): Promise<SharedProjectDetailResult> {
    const record = await this.#repository.findSharedForUser(projectId, userId);

    if (record === null || sharedProjectStatus(record) !== 'ACTIVE') {
      throw new ProjectNotFoundError();
    }

    return toDetailResult(record);
  }

  async remove(userId: string, projectId: string): Promise<SharedProjectRemoveResult> {
    const access = await this.#repository.findAccessStatus(projectId, userId);

    if (access === null) {
      const ownerId = await this.#repository.findProjectOwner(projectId);
      if (ownerId === userId) {
        throw new NotSharedProjectError();
      }
      throw new SharedProjectNotInListError();
    }
    if (access.revokedAt !== null) {
      throw new SharedProjectNotInListError();
    }

    const removedAt = this.#clock();
    const removed = await this.#repository.removeFromShared(projectId, userId, removedAt);

    if (!removed) {
      throw new SharedProjectNotInListError();
    }

    return {
      projectId,
      removedAt: removedAt.toISOString(),
    };
  }
}
