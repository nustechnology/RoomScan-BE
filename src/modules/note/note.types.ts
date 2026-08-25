import type {
  IdempotencyContext,
  IdempotencyResult,
} from '../../common/idempotency/idempotency.types.js';

export type NoteRole = 'OWNER' | 'VIEWER';
export type NoteColor = 'YELLOW' | 'RED' | 'BLUE' | 'GREEN' | 'ORANGE' | 'PURPLE' | 'CYAN' | 'GRAY';
export type NoteSort = 'createdAt:desc' | 'createdAt:asc' | 'updatedAt:desc' | 'updatedAt:asc';

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface NoteCreator {
  id: string;
  email: string | null;
  displayName: string | null;
}

export interface NoteRecord {
  id: string;
  scanId: string;
  createdById: string;
  creator: NoteCreator;
  title: string;
  content: string;
  color: NoteColor;
  position: Vector3;
  orientation: Vector3 | null;
  modelVersion: string;
  revision: number;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NotePermissions {
  role: NoteRole;
  canView: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export interface NoteResult {
  id: string;
  scanId: string;
  title: string;
  content: string;
  color: NoteColor;
  position: Vector3;
  orientation: Vector3 | null;
  modelVersion: string;
  revision: number;
  creator: NoteCreator;
  createdAt: string;
  updatedAt: string;
  permissions: NotePermissions;
}

export interface NoteCreateInput {
  title: string;
  content: string;
  color: NoteColor;
  position: Vector3;
  orientation: Vector3 | null;
  modelVersion: string;
}

export interface NoteUpdateInput {
  title?: string;
  content?: string;
  color?: NoteColor;
}

export interface NotePositionUpdateInput {
  position: Vector3;
  orientation: Vector3 | null;
  modelVersion: string;
}

export interface NoteListOptions {
  page: number;
  limit: number;
  sort: NoteSort;
}

export interface NoteListResult {
  items: NoteResult[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface NoteScanContext {
  projectId: string;
  modelVersion: number;
}

export interface NoteRepository {
  findScanContext(scanId: string): Promise<NoteScanContext | null>;
  findNoteContext(noteId: string): Promise<NoteScanContext | null>;
  findOwnedMutationContext?(noteId: string, ownerId: string): Promise<NoteScanContext | null>;
  create(scanId: string, createdById: string, data: NoteCreateInput): Promise<NoteRecord>;
  createIdempotently?(
    scanId: string,
    createdById: string,
    data: NoteCreateInput,
    context: IdempotencyContext,
  ): Promise<IdempotencyResult<NoteResult>>;
  listByScan(
    scanId: string,
    options: NoteListOptions,
  ): Promise<{
    items: NoteRecord[];
    total: number;
  }>;
  findByIdForUser(
    noteId: string,
    userId: string,
  ): Promise<{ record: NoteRecord; role: NoteRole } | null>;
  update(
    noteId: string,
    ownerId: string,
    expectedRevision: number,
    data: NoteUpdateInput,
  ): Promise<NoteRecord>;
  updatePosition(
    noteId: string,
    ownerId: string,
    expectedRevision: number,
    data: NotePositionUpdateInput,
  ): Promise<NoteRecord>;
  delete(noteId: string, ownerId: string, expectedRevision: number): Promise<number>;
}
