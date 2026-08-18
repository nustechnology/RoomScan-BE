import { ProjectNotFoundError } from '../project/project.errors.js';
import type { ProjectPermissionService } from '../project/project.permissions.js';
import { ScanNotFoundError } from '../scan/scan.errors.js';
import type { ScanPermissionService } from '../scan/scan.permissions.js';
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
  scanPermissions: ScanPermissionService;
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
    creator: record.creator,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    permissions: permissionsFor(role),
  };
}

export class NoteService {
  readonly #repository: NoteRepository;
  readonly #permissions: ProjectPermissionService;
  readonly #scanPermissions: ScanPermissionService;

  constructor({ repository, permissions, scanPermissions }: NoteServiceDependencies) {
    this.#repository = repository;
    this.#permissions = permissions;
    this.#scanPermissions = scanPermissions;
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
    return await this.#scanPermissions.requireView(scanId, userId);
  }

  async #requireNoteOwner(noteId: string, userId: string): Promise<string> {
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

  async update(userId: string, noteId: string, data: NoteUpdateInput): Promise<NoteResult> {
    await this.#requireNoteOwner(noteId, userId);
    const record = await this.#repository.update(noteId, userId, data);
    return toResult(record, 'OWNER');
  }

  async move(userId: string, noteId: string, data: NotePositionUpdateInput): Promise<NoteResult> {
    const scanModelVersion = await this.#requireNoteOwner(noteId, userId);

    if (data.modelVersion !== scanModelVersion) {
      throw new ModelVersionMismatchError();
    }

    const record = await this.#repository.updatePosition(noteId, userId, data);
    return toResult(record, 'OWNER');
  }

  async delete(userId: string, noteId: string): Promise<void> {
    await this.#requireNoteOwner(noteId, userId);
    await this.#repository.delete(noteId, userId);
  }
}
