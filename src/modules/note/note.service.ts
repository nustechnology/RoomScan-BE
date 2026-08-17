import { ProjectNotFoundError } from '../project/project.errors.js';
import type {
  IdempotencyGateway,
  IdempotencyResult,
} from '../../common/idempotency/idempotency.types.js';
import type { ProjectPermissionService } from '../project/project.permissions.js';
import { ScanNotFoundError } from '../scan/scan.errors.js';
import { ModelVersionMismatchError, NoteNotFoundError } from './note.errors.js';
import type {
  NoteCreateInput,
  NoteListOptions,
  NoteListResult,
  NotePositionUpdateInput,
  NoteRecord,
  NoteRepository,
  NoteResult,
  NoteRole,
  NoteUpdateInput,
} from './note.types.js';

export interface NoteServiceDependencies {
  repository: NoteRepository;
  permissions: ProjectPermissionService;
  idempotency?: IdempotencyGateway;
}

function permissionsFor(role: NoteRole): NoteResult['permissions'] {
  const isOwner = role === 'OWNER';

  return {
    role,
    canView: true,
    canEdit: isOwner,
    canDelete: isOwner,
  };
}

function toResult(record: NoteRecord, role: NoteRole): NoteResult {
  return {
    id: record.id,
    scanId: record.scanId,
    content: record.content,
    color: record.color,
    position: record.position,
    orientation: record.orientation,
    modelVersion: record.modelVersion,
    revision: record.revision ?? 1,
    creator: record.creator,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    permissions: permissionsFor(role),
  };
}

export class NoteService {
  readonly #repository: NoteRepository;
  readonly #permissions: ProjectPermissionService;
  readonly #idempotency: IdempotencyGateway | undefined;

  constructor({ repository, permissions, idempotency }: NoteServiceDependencies) {
    this.#repository = repository;
    this.#permissions = permissions;
    this.#idempotency = idempotency;
  }

  async #requireScanOwner(scanId: string, userId: string): Promise<NoteRecord['modelVersion']> {
    const context = await this.#repository.findScanContext(scanId);

    if (context === null) {
      throw new ScanNotFoundError();
    }

    try {
      await this.#permissions.requireOwner(context.projectId, userId);
    } catch (error) {
      if (error instanceof ProjectNotFoundError) {
        throw new ScanNotFoundError();
      }
      throw error;
    }

    return context.modelVersion.toString();
  }

  async #requireScanView(scanId: string, userId: string): Promise<NoteRole> {
    const context = await this.#repository.findScanContext(scanId);

    if (context === null) {
      throw new ScanNotFoundError();
    }

    try {
      return await this.#permissions.requireView(context.projectId, userId);
    } catch (error) {
      if (error instanceof ProjectNotFoundError) {
        throw new ScanNotFoundError();
      }
      throw error;
    }
  }

  async #requireNoteOwner(noteId: string, userId: string): Promise<string> {
    if (this.#repository.findOwnedMutationContext !== undefined) {
      const mutationContext = await this.#repository.findOwnedMutationContext(noteId, userId);
      if (mutationContext === null) {
        throw new NoteNotFoundError();
      }
      return mutationContext.modelVersion.toString();
    }

    const context = await this.#repository.findNoteContext(noteId);

    if (context === null) {
      throw new NoteNotFoundError();
    }

    try {
      await this.#permissions.requireOwner(context.projectId, userId);
    } catch (error) {
      if (error instanceof ProjectNotFoundError) {
        throw new NoteNotFoundError();
      }
      throw error;
    }

    return context.modelVersion.toString();
  }

  async create(userId: string, scanId: string, data: NoteCreateInput): Promise<NoteResult> {
    const scanModelVersion = await this.#requireScanOwner(scanId, userId);

    if (data.modelVersion !== scanModelVersion) {
      throw new ModelVersionMismatchError();
    }

    const record = await this.#repository.create(scanId, userId, data);
    return toResult(record, 'OWNER');
  }

  async createIdempotently(
    userId: string,
    scanId: string,
    data: NoteCreateInput,
    key: string,
  ): Promise<IdempotencyResult<NoteResult>> {
    if (this.#idempotency === undefined || this.#repository.createIdempotently === undefined) {
      throw new Error('Note idempotency is not configured');
    }
    const context = this.#idempotency.createContext({
      userId,
      operation: 'CREATE_NOTE',
      parentScope: `scan:${scanId}`,
      key,
      request: data,
    });
    const replay = await this.#idempotency.lookup<NoteResult>(context);
    if (replay !== null) return replay;

    const scanModelVersion = await this.#requireScanOwner(scanId, userId);
    if (data.modelVersion !== scanModelVersion) throw new ModelVersionMismatchError();
    return await this.#repository.createIdempotently(scanId, userId, data, context);
  }

  async list(userId: string, scanId: string, options: NoteListOptions): Promise<NoteListResult> {
    const role = await this.#requireScanView(scanId, userId);
    const { items, total } = await this.#repository.listByScan(scanId, options);

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

  async getById(userId: string, noteId: string): Promise<NoteResult> {
    const result = await this.#repository.findByIdForUser(noteId, userId);

    if (result === null) {
      throw new NoteNotFoundError();
    }

    return toResult(result.record, result.role);
  }

  async update(
    userId: string,
    noteId: string,
    expectedRevisionOrData: number | NoteUpdateInput,
    maybeData?: NoteUpdateInput,
  ): Promise<NoteResult> {
    const expectedRevision =
      typeof expectedRevisionOrData === 'number' ? expectedRevisionOrData : undefined;
    const data =
      typeof expectedRevisionOrData === 'number' ? (maybeData ?? {}) : expectedRevisionOrData;
    await this.#requireNoteOwner(noteId, userId);
    const record =
      expectedRevision === undefined
        ? await this.#repository.update(noteId, userId, data)
        : await this.#repository.update(noteId, userId, expectedRevision, data);
    return toResult(record, 'OWNER');
  }

  async move(
    userId: string,
    noteId: string,
    expectedRevisionOrData: number | NotePositionUpdateInput,
    maybeData?: NotePositionUpdateInput,
  ): Promise<NoteResult> {
    const expectedRevision =
      typeof expectedRevisionOrData === 'number' ? expectedRevisionOrData : undefined;
    const data =
      typeof expectedRevisionOrData === 'number'
        ? (maybeData as NotePositionUpdateInput)
        : expectedRevisionOrData;
    const scanModelVersion = await this.#requireNoteOwner(noteId, userId);

    if (data.modelVersion !== scanModelVersion) {
      throw new ModelVersionMismatchError();
    }

    const record =
      expectedRevision === undefined
        ? await this.#repository.updatePosition(noteId, userId, data)
        : await this.#repository.updatePosition(noteId, userId, expectedRevision, data);
    return toResult(record, 'OWNER');
  }

  async delete(
    userId: string,
    noteId: string,
    expectedRevision?: number,
  ): Promise<number | undefined> {
    await this.#requireNoteOwner(noteId, userId);
    return expectedRevision === undefined
      ? await this.#repository.delete(noteId, userId)
      : await this.#repository.delete(noteId, userId, expectedRevision);
  }
}
