import { toPaginationMeta } from '../../common/pagination/pagination.js';
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
import type {
  IdempotencyGateway,
  IdempotencyResult,
} from '../../common/idempotency/idempotency.types.js';

export interface ProjectServiceDependencies {
  repository: ProjectRepository;
  permissions: ProjectPermissionService;
  idempotency?: IdempotencyGateway;
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
    scans: record.scans.map((scan) => ({
      ...scan,
      createdAt: scan.createdAt.toISOString(),
    })),
    sharedCount: record.sharedCount,
    thumbnail: record.thumbnail,
    syncStatus: record.syncStatus,
    revision: record.revision,
    ...(!Object.hasOwn(record, 'lastSyncedAt')
      ? {}
      : { lastSyncedAt: record.lastSyncedAt?.toISOString() ?? null }),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    permissions: permissionsFor(role),
  };
}

export class ProjectService {
  readonly #repository: ProjectRepository;
  readonly #idempotency: IdempotencyGateway | undefined;

  constructor({ repository, permissions, idempotency }: ProjectServiceDependencies) {
    this.#repository = repository;
    void permissions;
    this.#idempotency = idempotency;
  }

  async create(ownerId: string, data: ProjectCreateInput): Promise<ProjectResult> {
    const record = await this.#repository.create(ownerId, data);
    return toResult(record, 'OWNER');
  }

  async createIdempotently(
    ownerId: string,
    data: ProjectCreateInput,
    key: string,
  ): Promise<IdempotencyResult<ProjectResult>> {
    if (this.#idempotency === undefined || this.#repository.createIdempotently === undefined) {
      throw new Error('Project idempotency is not configured');
    }
    const context = this.#idempotency.createContext({
      userId: ownerId,
      operation: 'CREATE_PROJECT',
      parentScope: `owner:${ownerId}`,
      key,
      request: data,
    });
    const replay = await this.#idempotency.lookup<ProjectResult>(context);
    if (replay !== null) {
      return replay;
    }
    return await this.#repository.createIdempotently(ownerId, data, context);
  }

  async list(ownerId: string, options: ProjectListOptions): Promise<ProjectListResult> {
    const { items, total } = await this.#repository.list(ownerId, options);
    return {
      items: items.map((item) => toResult(item, 'OWNER')),
      pagination: toPaginationMeta(options, total),
    };
  }

  async getById(userId: string, projectId: string): Promise<ProjectResult> {
    const project = await this.#repository.findByIdForUser(projectId, userId);
    if (project === null) {
      throw new ProjectNotFoundError();
    }
    return toResult(project.record, project.role);
  }

  async update(
    ownerId: string,
    projectId: string,
    expectedRevision: number,
    data: ProjectUpdateInput,
  ): Promise<ProjectResult> {
    const record = await this.#repository.update(projectId, ownerId, expectedRevision, data);
    return toResult(record, 'OWNER');
  }

  async delete(ownerId: string, projectId: string, expectedRevision: number): Promise<number> {
    return await this.#repository.softDelete(projectId, ownerId, expectedRevision);
  }
}
