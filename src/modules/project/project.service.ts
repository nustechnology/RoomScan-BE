import { ProjectNotFoundError } from './project.errors.js';
import type { ProjectPermissionService } from './project.permissions.js';
import type {
  ProjectCreateInput,
  ProjectListOptions,
  ProjectListResult,
  ProjectRecord,
  ProjectRepository,
  ProjectResult,
  ProjectUpdateInput,
  ProjectRole,
} from './project.types.js';

export interface ProjectServiceDependencies {
  repository: ProjectRepository;
  permissions: ProjectPermissionService;
}

function permissionsFor(role: ProjectRole): ProjectResult['permissions'] {
  const isOwner = role === 'OWNER';

  return {
    role,
    canView: true,
    canEdit: isOwner,
    canDelete: isOwner,
    canShare: isOwner,
    canCreateScan: isOwner,
  };
}

function toResult(record: ProjectRecord, role: ProjectRole): ProjectResult {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    owner: record.owner,
    scanCount: record.scanCount,
    sharedCount: record.sharedCount,
    thumbnail: record.thumbnail,
    syncStatus: record.syncStatus,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    permissions: permissionsFor(role),
  };
}

export class ProjectService {
  readonly #repository: ProjectRepository;
  readonly #permissions: ProjectPermissionService;

  constructor({ repository, permissions }: ProjectServiceDependencies) {
    this.#repository = repository;
    this.#permissions = permissions;
  }

  async create(ownerId: string, data: ProjectCreateInput): Promise<ProjectResult> {
    const record = await this.#repository.create(ownerId, data);
    return toResult(record, 'OWNER');
  }

  async list(ownerId: string, options: ProjectListOptions): Promise<ProjectListResult> {
    const { items, total } = await this.#repository.list(ownerId, options);
    return {
      items: items.map((item) => toResult(item, 'OWNER')),
      pagination: {
        page: options.page,
        limit: options.limit,
        total,
        totalPages: Math.ceil(total / options.limit),
      },
    };
  }

  async getById(userId: string, projectId: string): Promise<ProjectResult> {
    const record = await this.#repository.findById(projectId);
    if (record === null) {
      throw new ProjectNotFoundError();
    }
    const role = await this.#permissions.requireView(projectId, userId);
    return toResult(record, role);
  }

  async update(
    ownerId: string,
    projectId: string,
    data: ProjectUpdateInput,
  ): Promise<ProjectResult> {
    await this.#permissions.requireOwner(projectId, ownerId);
    const record = await this.#repository.update(projectId, ownerId, data);
    return toResult(record, 'OWNER');
  }

  async delete(ownerId: string, projectId: string): Promise<void> {
    await this.#repository.softDelete(projectId, ownerId);
  }
}
