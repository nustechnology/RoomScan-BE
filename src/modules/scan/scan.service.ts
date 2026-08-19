import { randomUUID } from 'node:crypto';

import { ProjectNotFoundError } from '../project/project.errors.js';
import type {
  IdempotencyGateway,
  IdempotencyResult,
} from '../../common/idempotency/idempotency.types.js';
import type { ProjectPermissionService } from '../project/project.permissions.js';
import { ScanNotFoundError } from './scan.errors.js';
import type {
  ScanCreateInput,
  ScanCreateUploadDescriptor,
  ScanCreateWithUploadsResult,
  ScanListOptions,
  ScanListResult,
  ScanRecord,
  ScanRepository,
  ScanResult,
  ScanRole,
  ScanUpdateInput,
  ScanUploadPreparer,
} from './scan.types.js';

export interface ScanServiceDependencies {
  repository: ScanRepository;
  permissions: ProjectPermissionService;
  idempotency?: IdempotencyGateway;
  uploadPreparer?: ScanUploadPreparer;
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
    revision: record.revision,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    permissions: permissionsFor(role),
  };
}

export class ScanService {
  readonly #repository: ScanRepository;
  readonly #permissions: ProjectPermissionService;
  readonly #idempotency: IdempotencyGateway | undefined;
  readonly #uploadPreparer: ScanUploadPreparer | undefined;

  constructor({ repository, permissions, idempotency, uploadPreparer }: ScanServiceDependencies) {
    this.#repository = repository;
    this.#permissions = permissions;
    this.#idempotency = idempotency;
    this.#uploadPreparer = uploadPreparer;
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

    const { record, created } = await this.#repository.create(projectId, userId, data);
    return { scan: toResult(record, 'OWNER'), created };
  }

  async createIdempotently(
    userId: string,
    projectId: string,
    data: ScanCreateInput,
    key: string,
    requestPayload: unknown = data,
  ): Promise<IdempotencyResult<ScanResult>> {
    if (this.#idempotency === undefined) {
      throw new Error('Scan idempotency is not configured');
    }
    const context = this.#idempotency.createContext({
      userId,
      operation: 'CREATE_SCAN',
      parentScope: `project:${projectId}`,
      key,
      request: requestPayload,
    });
    const replay = await this.#idempotency.lookup<ScanResult>(context);
    if (replay !== null) return replay;

    try {
      await this.#permissions.requireOwner(projectId, userId);
    } catch (error) {
      if (error instanceof ProjectNotFoundError) throw new ScanNotFoundError();
      throw error;
    }
    return await this.#repository.createIdempotently(projectId, userId, data, context);
  }

  async createWithUploadsIdempotently(
    userId: string,
    projectId: string,
    data: ScanCreateInput,
    uploads: ScanCreateUploadDescriptor[],
    key: string,
    requestPayload: unknown,
  ): Promise<IdempotencyResult<ScanCreateWithUploadsResult>> {
    if (this.#idempotency === undefined || this.#uploadPreparer === undefined) {
      throw new Error('Transactional scan upload creation is not configured');
    }
    const context = this.#idempotency.createContext({
      userId,
      operation: 'CREATE_SCAN',
      parentScope: `project:${projectId}`,
      key,
      request: requestPayload,
    });
    const replay = await this.#idempotency.lookup<ScanCreateWithUploadsResult>(context);
    if (replay !== null) return replay;

    try {
      await this.#permissions.requireOwner(projectId, userId);
    } catch (error) {
      if (error instanceof ProjectNotFoundError) throw new ScanNotFoundError();
      throw error;
    }

    const scanId = randomUUID();
    const prepared = await this.#uploadPreparer.prepareScanCreateUploads(scanId, uploads);
    return await this.#repository.createWithUploadsIdempotently(
      scanId,
      projectId,
      userId,
      data,
      prepared,
      context,
    );
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

  async update(
    userId: string,
    scanId: string,
    expectedRevision: number,
    data: ScanUpdateInput,
  ): Promise<ScanResult> {
    const record = await this.#repository.update(scanId, userId, expectedRevision, data);
    return toResult(record, 'OWNER');
  }

  async delete(userId: string, scanId: string, expectedRevision: number): Promise<number> {
    return await this.#repository.softDelete(scanId, userId, expectedRevision);
  }
}
