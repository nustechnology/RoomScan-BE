import { describe, expect, it, vi } from 'vitest';

import type { ProjectRepository } from '../src/modules/project/project.types.js';
import { ProjectPermissionService } from '../src/modules/project/project.permissions.js';
import { ScanNotFoundError } from '../src/modules/scan/scan.errors.js';
import type { ScanRepository } from '../src/modules/scan/scan.types.js';
import { ScanPermissionService } from '../src/modules/scan/scan.permissions.js';
import { ModelVersionMismatchError, NoteNotFoundError } from '../src/modules/note/note.errors.js';
import { NoteService } from '../src/modules/note/note.service.js';
import type { NoteRecord, NoteRepository } from '../src/modules/note/note.types.js';

const OWNER_ID = 'eb5d278f-c857-45c7-887d-7be65288cb75';
const VIEWER_ID = '8c53d31d-2788-48de-82a0-c4f219ca3701';
const PROJECT_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const SCAN_ID = 'f1e2d3c4-a5b6-7890-abcd-ef1234567890';
const NOTE_ID = 'b1a2c3d4-e5f6-4890-abcd-ef1234567890';
const NOW = new Date('2026-07-29T10:00:00.000Z');

function createRecord(overrides: Partial<NoteRecord> = {}): NoteRecord {
  return {
    id: NOTE_ID,
    scanId: SCAN_ID,
    createdById: OWNER_ID,
    creator: {
      id: OWNER_ID,
      email: 'owner@example.com',
    },
    title: 'Cabinet hinge',
    content: 'Cabinet hinge is loose',
    color: 'YELLOW',
    position: { x: 1.5, y: -2, z: 3.25 },
    orientation: { x: 0, y: 0, z: 1 },
    modelVersion: '1',
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function createHarness() {
  const mocks = {
    findScanContext: vi
      .fn<NoteRepository['findScanContext']>()
      .mockResolvedValue({ projectId: PROJECT_ID, modelVersion: 1 }),
    findNoteContext: vi
      .fn<NoteRepository['findNoteContext']>()
      .mockResolvedValue({ projectId: PROJECT_ID, modelVersion: 1 }),
    create: vi.fn<NoteRepository['create']>().mockResolvedValue(createRecord()),
    listByScan: vi
      .fn<NoteRepository['listByScan']>()
      .mockResolvedValue({ items: [createRecord()], total: 1 }),
    findByIdForUser: vi
      .fn<NoteRepository['findByIdForUser']>()
      .mockResolvedValue({ record: createRecord(), role: 'OWNER' }),
    update: vi.fn<NoteRepository['update']>().mockResolvedValue(createRecord()),
    updatePosition: vi.fn<NoteRepository['updatePosition']>().mockResolvedValue(createRecord()),
    delete: vi.fn<NoteRepository['delete']>().mockResolvedValue(2),
  };
  const repository: NoteRepository = mocks;
  const findAccessRole = vi
    .fn<ProjectRepository['findAccessRole']>()
    .mockImplementation(async (_projectId, userId) =>
      Promise.resolve(userId === OWNER_ID ? 'OWNER' : userId === VIEWER_ID ? 'VIEWER' : null),
    );
  const permissions = new ProjectPermissionService({
    findAccessRole,
  } as unknown as ProjectRepository);
  const scanFindAccessRole = vi
    .fn<ScanRepository['findAccessRole']>()
    .mockImplementation(async (_scanId, userId) =>
      Promise.resolve(userId === OWNER_ID ? 'OWNER' : userId === VIEWER_ID ? 'VIEWER' : null),
    );
  const scanPermissions = new ScanPermissionService({
    findAccessRole: scanFindAccessRole,
  } as unknown as ScanRepository);
  const service = new NoteService({ repository, permissions, scanPermissions });

  return {
    mocks,
    repository,
    permissions,
    scanPermissions,
    service,
    findAccessRole,
    scanFindAccessRole,
  };
}

describe('NoteService', () => {
  it('creates a note as the Owner', async () => {
    const { mocks, service } = createHarness();

    const result = await service.create(OWNER_ID, SCAN_ID, {
      title: 'Cabinet hinge',
      content: 'Cabinet hinge is loose',
      color: 'YELLOW',
      position: { x: 1.5, y: -2, z: 3.25 },
      orientation: null,
      modelVersion: '1',
    });

    expect(mocks.findScanContext).toHaveBeenCalledWith(SCAN_ID);
    expect(mocks.create).toHaveBeenCalledWith(SCAN_ID, OWNER_ID, {
      title: 'Cabinet hinge',
      content: 'Cabinet hinge is loose',
      color: 'YELLOW',
      position: { x: 1.5, y: -2, z: 3.25 },
      orientation: null,
      modelVersion: '1',
    });
    expect(result.title).toBe('Cabinet hinge');
    expect(result.content).toBe('Cabinet hinge is loose');
    expect(result.permissions.role).toBe('OWNER');
  });

  it('rejects create from a Viewer', async () => {
    const { service } = createHarness();

    await expect(
      service.create(VIEWER_ID, SCAN_ID, {
        title: 'Not allowed',
        content: 'Not allowed',
        color: 'YELLOW',
        position: { x: 1, y: 2, z: 3 },
        orientation: null,
        modelVersion: '1',
      }),
    ).rejects.toBeInstanceOf(ScanNotFoundError);
  });

  it('rejects create when the scan is missing or deleted', async () => {
    const { mocks, service } = createHarness();
    mocks.findScanContext.mockResolvedValueOnce(null);

    await expect(
      service.create(OWNER_ID, SCAN_ID, {
        title: 'Not allowed',
        content: 'Not allowed',
        color: 'YELLOW',
        position: { x: 1, y: 2, z: 3 },
        orientation: null,
        modelVersion: '1',
      }),
    ).rejects.toBeInstanceOf(ScanNotFoundError);
  });

  it('rejects create when the model version does not match the scan', async () => {
    const { mocks, service } = createHarness();
    mocks.findScanContext.mockResolvedValueOnce({ projectId: PROJECT_ID, modelVersion: 1 });

    await expect(
      service.create(OWNER_ID, SCAN_ID, {
        title: 'Stale note',
        content: 'Stale note',
        color: 'YELLOW',
        position: { x: 1, y: 2, z: 3 },
        orientation: null,
        modelVersion: '2',
      }),
    ).rejects.toBeInstanceOf(ModelVersionMismatchError);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('lists notes for an Owner', async () => {
    const { mocks, service } = createHarness();

    const result = await service.list(OWNER_ID, SCAN_ID, {
      page: 1,
      limit: 20,
      sort: 'updatedAt:desc',
    });

    expect(mocks.listByScan).toHaveBeenCalledWith(SCAN_ID, {
      page: 1,
      limit: 20,
      sort: 'updatedAt:desc',
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.permissions.role).toBe('OWNER');
  });

  it('lists notes for an active Viewer', async () => {
    const { service } = createHarness();

    const result = await service.list(VIEWER_ID, SCAN_ID, {
      page: 1,
      limit: 20,
      sort: 'updatedAt:desc',
    });

    expect(result.items[0]?.permissions.role).toBe('VIEWER');
    expect(result.items[0]?.permissions.canEdit).toBe(false);
    expect(result.items[0]?.permissions.canDelete).toBe(false);
  });

  it('rejects list when the Viewer has no scan access', async () => {
    const { scanFindAccessRole, service } = createHarness();
    scanFindAccessRole.mockResolvedValueOnce(null);

    await expect(
      service.list(VIEWER_ID, SCAN_ID, {
        page: 1,
        limit: 20,
        sort: 'updatedAt:desc',
      }),
    ).rejects.toBeInstanceOf(ScanNotFoundError);
  });

  it('returns note detail for an Owner', async () => {
    const { mocks, service } = createHarness();

    const result = await service.getById(OWNER_ID, NOTE_ID);

    expect(mocks.findByIdForUser).toHaveBeenCalledWith(NOTE_ID, OWNER_ID);
    expect(result.permissions.role).toBe('OWNER');
  });

  it('returns note detail for an active Viewer', async () => {
    const { mocks, service } = createHarness();
    mocks.findByIdForUser.mockResolvedValueOnce({ record: createRecord(), role: 'VIEWER' });

    const result = await service.getById(VIEWER_ID, NOTE_ID);

    expect(result.permissions.role).toBe('VIEWER');
  });

  it('throws hidden not-found for a missing or inaccessible note', async () => {
    const { mocks, service } = createHarness();
    mocks.findByIdForUser.mockResolvedValueOnce(null);

    await expect(service.getById(OWNER_ID, NOTE_ID)).rejects.toBeInstanceOf(NoteNotFoundError);
  });

  it('updates content and color as the Owner', async () => {
    const { mocks, service } = createHarness();
    mocks.update.mockResolvedValueOnce(createRecord({ content: 'Updated content' }));

    const result = await service.update(OWNER_ID, NOTE_ID, 1, { content: 'Updated content' });

    expect(mocks.findNoteContext).toHaveBeenCalledWith(NOTE_ID);
    expect(mocks.update).toHaveBeenCalledWith(NOTE_ID, OWNER_ID, 1, { content: 'Updated content' });
    expect(result.content).toBe('Updated content');
  });

  it('rejects update from a Viewer', async () => {
    const { service } = createHarness();

    await expect(service.update(VIEWER_ID, NOTE_ID, 1, { color: 'RED' })).rejects.toBeInstanceOf(
      NoteNotFoundError,
    );
  });

  it('throws hidden not-found when updating a missing note', async () => {
    const { mocks, service } = createHarness();
    mocks.findNoteContext.mockResolvedValueOnce(null);

    await expect(service.update(OWNER_ID, NOTE_ID, 1, { color: 'RED' })).rejects.toBeInstanceOf(
      NoteNotFoundError,
    );
  });

  it('moves a note as the Owner when the model version matches', async () => {
    const { mocks, service } = createHarness();
    mocks.updatePosition.mockResolvedValueOnce(createRecord({ position: { x: 9, y: 8, z: 7 } }));

    const result = await service.move(OWNER_ID, NOTE_ID, 1, {
      position: { x: 9, y: 8, z: 7 },
      orientation: null,
      modelVersion: '1',
    });

    expect(mocks.updatePosition).toHaveBeenCalledWith(NOTE_ID, OWNER_ID, 1, {
      position: { x: 9, y: 8, z: 7 },
      orientation: null,
      modelVersion: '1',
    });
    expect(result.position).toEqual({ x: 9, y: 8, z: 7 });
  });

  it('rejects a move with a stale model version', async () => {
    const { mocks, service } = createHarness();
    mocks.findNoteContext.mockResolvedValueOnce({ projectId: PROJECT_ID, modelVersion: 2 });

    await expect(
      service.move(OWNER_ID, NOTE_ID, 1, {
        position: { x: 9, y: 8, z: 7 },
        orientation: null,
        modelVersion: '1',
      }),
    ).rejects.toBeInstanceOf(ModelVersionMismatchError);
    expect(mocks.updatePosition).not.toHaveBeenCalled();
  });

  it('rejects move from a Viewer', async () => {
    const { service } = createHarness();

    await expect(
      service.move(VIEWER_ID, NOTE_ID, 1, {
        position: { x: 9, y: 8, z: 7 },
        orientation: null,
        modelVersion: '1',
      }),
    ).rejects.toBeInstanceOf(NoteNotFoundError);
  });

  it('deletes a note as the Owner', async () => {
    const { mocks, service } = createHarness();

    await service.delete(OWNER_ID, NOTE_ID, 1);

    expect(mocks.findNoteContext).toHaveBeenCalledWith(NOTE_ID);
    expect(mocks.delete).toHaveBeenCalledWith(NOTE_ID, OWNER_ID, 1);
  });

  it('rejects delete from a Viewer', async () => {
    const { service } = createHarness();

    await expect(service.delete(VIEWER_ID, NOTE_ID, 1)).rejects.toBeInstanceOf(NoteNotFoundError);
  });

  it('throws hidden not-found when deleting a missing note', async () => {
    const { mocks, service } = createHarness();
    mocks.findNoteContext.mockResolvedValueOnce(null);

    await expect(service.delete(OWNER_ID, NOTE_ID, 1)).rejects.toBeInstanceOf(NoteNotFoundError);
  });

  it('rejects an idempotent create when idempotency is not configured', async () => {
    const { service } = createHarness();

    await expect(
      service.createIdempotently(
        OWNER_ID,
        SCAN_ID,
        {
          title: 'Note',
          content: 'Note',
          color: 'YELLOW',
          position: { x: 1, y: 2, z: 3 },
          orientation: null,
          modelVersion: '1',
        },
        'k',
      ),
    ).rejects.toThrow('Note idempotency is not configured');
  });

  it('replays a stored idempotent create', async () => {
    const { repository, permissions, scanPermissions } = createHarness();
    const context = {
      userId: OWNER_ID,
      operation: 'CREATE_NOTE' as const,
      parentScope: `scan:${SCAN_ID}`,
      keyHash: 'key-hash',
      requestHash: 'request-hash',
    };
    const idempotency = {
      createContext: vi.fn().mockReturnValue(context),
      lookup: vi.fn().mockResolvedValue({ body: { id: NOTE_ID }, statusCode: 201, replayed: true }),
    };
    const createIdempotently = vi.fn();
    repository.createIdempotently = createIdempotently;
    const service = new NoteService({ repository, permissions, scanPermissions, idempotency });

    const result = await service.createIdempotently(
      OWNER_ID,
      SCAN_ID,
      {
        title: 'Note',
        content: 'Note',
        color: 'YELLOW',
        position: { x: 1, y: 2, z: 3 },
        orientation: null,
        modelVersion: '1',
      },
      'k',
    );

    expect(idempotency.lookup).toHaveBeenCalledWith(context);
    expect(createIdempotently).not.toHaveBeenCalled();
    expect(result.replayed).toBe(true);
  });

  it('rejects an idempotent create with a stale model version', async () => {
    const { repository, permissions, scanPermissions, mocks } = createHarness();
    mocks.findScanContext.mockResolvedValueOnce({ projectId: PROJECT_ID, modelVersion: 1 });
    const context = {
      userId: OWNER_ID,
      operation: 'CREATE_NOTE' as const,
      parentScope: `scan:${SCAN_ID}`,
      keyHash: 'key-hash',
      requestHash: 'request-hash',
    };
    const idempotency = {
      createContext: vi.fn().mockReturnValue(context),
      lookup: vi.fn().mockResolvedValue(null),
    };
    const createIdempotently = vi.fn();
    repository.createIdempotently = createIdempotently;
    const service = new NoteService({ repository, permissions, scanPermissions, idempotency });

    await expect(
      service.createIdempotently(
        OWNER_ID,
        SCAN_ID,
        {
          title: 'Note',
          content: 'Note',
          color: 'YELLOW',
          position: { x: 1, y: 2, z: 3 },
          orientation: null,
          modelVersion: '2',
        },
        'k',
      ),
    ).rejects.toBeInstanceOf(ModelVersionMismatchError);
    expect(createIdempotently).not.toHaveBeenCalled();
  });

  it('resolves note ownership through the mutation context when available', async () => {
    const { repository, permissions, scanPermissions } = createHarness();
    const findOwnedMutationContext = vi
      .fn<NonNullable<NoteRepository['findOwnedMutationContext']>>()
      .mockResolvedValue({ projectId: PROJECT_ID, modelVersion: 1 });
    repository.findOwnedMutationContext = findOwnedMutationContext;
    const service = new NoteService({ repository, permissions, scanPermissions });

    await expect(service.getById(OWNER_ID, NOTE_ID)).resolves.toBeDefined();
  });

  it('hides a note whose owned mutation context is missing', async () => {
    const { repository, permissions, scanPermissions, mocks } = createHarness();
    const findOwnedMutationContext = vi
      .fn<NonNullable<NoteRepository['findOwnedMutationContext']>>()
      .mockResolvedValue(null);
    repository.findOwnedMutationContext = findOwnedMutationContext;
    mocks.update.mockResolvedValue(createRecord());
    const service = new NoteService({ repository, permissions, scanPermissions });

    await expect(
      service.update(OWNER_ID, NOTE_ID, 1, { content: 'Updated' }),
    ).rejects.toBeInstanceOf(NoteNotFoundError);
  });

  it('rethrows a non-not-found permission error from create', async () => {
    const { service, findAccessRole } = createHarness();
    findAccessRole.mockRejectedValueOnce(new Error('boom'));

    await expect(
      service.create(OWNER_ID, SCAN_ID, {
        title: 'Note',
        content: 'Note',
        color: 'YELLOW',
        position: { x: 1, y: 2, z: 3 },
        orientation: null,
        modelVersion: '1',
      }),
    ).rejects.toThrow('boom');
  });
});
