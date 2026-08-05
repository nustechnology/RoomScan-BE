import { ProjectNotFoundError } from '../project/project.errors.js';
import type { ProjectPermissionService } from '../project/project.permissions.js';
import { ScanNotFoundError } from './scan.errors.js';
import type {
  ScanCreateInput,
  ScanListOptions,
  ScanListResult,
  ScanRecord,
  ScanRepository,
  ScanResult,
  ScanRole,
  ScanUpdateInput,
} from './scan.types.js';

export interface ScanServiceDependencies {
  repository: ScanRepository;
  permissions: ProjectPermissionService;
}

export interface ScanCreateOutcome {
  scan: ScanResult;
  created: boolean;
}

function permissionsFor(role: ScanRole): ScanResult['permissions'] {
  const isOwner = role === 'OWNER';

  return {
    role,
    canView: true,
    canEdit: isOwner,
    canDelete: isOwner,
  };
}

function toResult(record: ScanRecord, role: ScanRole): ScanResult {
  return {
    id: record.id,
    projectId: record.projectId,
    name: record.name,
    description: record.description,
    thumbnail: record.thumbnail,
    creator: record.creator,
    noteCount: record.noteCount,
    assetStatus: record.assetStatus,
    syncStatus: record.syncStatus,
    modelVersion: record.modelVersion,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    permissions: permissionsFor(role),
  };
}

export class ScanService {
  readonly #repository: ScanRepository;
  readonly #permissions: ProjectPermissionService;

  constructor({ repository, permissions }: ScanServiceDependencies) {
    this.#repository = repository;
    this.#permissions = permissions;
  }

  async create(
    userId: string,
    projectId: string,
    data: ScanCreateInput,
  ): Promise<ScanCreateOutcome> {
    try {
      await this.#permissions.requireOwner(projectId, userId);
    } catch (error) {
      if (error instanceof ProjectNotFoundError) {
        throw new ScanNotFoundError();
      }
      throw error;
    }

    if (data.clientMutationId !== undefined) {
      const existing = await this.#repository.findByClientMutationId(data.clientMutationId);

      if (existing !== null && existing.deletedAt === null) {
        return { scan: toResult(existing, 'OWNER'), created: false };
      }
    }

    const record = await this.#repository.create(projectId, userId, data);
    return { scan: toResult(record, 'OWNER'), created: true };
  }

  async list(userId: string, projectId: string, options: ScanListOptions): Promise<ScanListResult> {
    let role: 'OWNER' | 'VIEWER';

    try {
      role = await this.#permissions.requireView(projectId, userId);
    } catch (error) {
      if (error instanceof ProjectNotFoundError) {
        throw new ScanNotFoundError();
      }
      throw error;
    }

    const { items, total } = await this.#repository.listByProject(projectId, options);

    return {
      items: items.map((item) => toResult(item, role)),
      pagination: {
        page: options.page,
        limit: options.limit,
        total,
        totalPages: Math.ceil(total / options.limit),
      },
    };
  }

  async getById(userId: string, scanId: string): Promise<ScanResult> {
    const result = await this.#repository.findByIdForUser(scanId, userId);

    if (result === null) {
      throw new ScanNotFoundError();
    }

    return toResult(result.record, result.role);
  }

  async update(userId: string, scanId: string, data: ScanUpdateInput): Promise<ScanResult> {
    const projectId = await this.#repository.findProjectId(scanId);

    if (projectId === null) {
      throw new ScanNotFoundError();
    }

    try {
      await this.#permissions.requireOwner(projectId, userId);
    } catch (error) {
      if (error instanceof ProjectNotFoundError) {
        throw new ScanNotFoundError();
      }
      throw error;
    }

    const record = await this.#repository.update(scanId, userId, data);
    return toResult(record, 'OWNER');
  }

  async delete(userId: string, scanId: string): Promise<void> {
    const projectId = await this.#repository.findProjectId(scanId);

    if (projectId === null) {
      throw new ScanNotFoundError();
    }

    try {
      await this.#permissions.requireOwner(projectId, userId);
    } catch (error) {
      if (error instanceof ProjectNotFoundError) {
        throw new ScanNotFoundError();
      }
      throw error;
    }

    await this.#repository.softDelete(scanId, userId);
  }
}
