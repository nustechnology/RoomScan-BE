import { describe, expect, it, vi } from 'vitest';

import { Prisma, type PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaNoteRepository } from '../src/infrastructure/database/prisma-note-repository.js';
import type { PrismaIdempotencyExecutor } from '../src/infrastructure/database/prisma-idempotency.js';
import { NoteNotFoundError } from '../src/modules/note/note.errors.js';

const OWNER_ID = 'eb5d278f-c857-45c7-887d-7be65288cb75';
const VIEWER_ID = '8c53d31d-2788-48de-82a0-c4f219ca3701';
const PROJECT_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const SCAN_ID = 'f1e2d3c4-a5b6-7890-abcd-ef1234567890';
const NOTE_ID = 'b1a2c3d4-e5f6-4890-abcd-ef1234567890';
const NOW = new Date('2026-07-29T10:00:00.000Z');

const noteSelect = {
  id: true,
  scanId: true,
  createdById: true,
  creator: {
    select: {
      id: true,
      email: true,
    },
  },
  content: true,
  color: true,
  position: true,
  orientation: true,
  modelVersion: true,
  revision: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
};

function createNoteRow(overrides: Record<string, unknown> = {}) {
  return {
    id: NOTE_ID,
    scanId: SCAN_ID,
    createdById: OWNER_ID,
    creator: {
      id: OWNER_ID,
      email: 'owner@example.com',
    },
    content: 'Cabinet hinge is loose',
    color: 'YELLOW',
    position: { x: 1.5, y: -2, z: 3.25 },
    orientation: { x: 0, y: 0, z: 1 },
    modelVersion: '1',
    revision: 1,
    deletedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    scan: {
      projectId: PROJECT_ID,
      modelVersion: 1,
      project: { ownerId: OWNER_ID },
    },
    ...overrides,
  };
}

function createClient() {
  const note = {
    create: vi.fn().mockResolvedValue(createNoteRow()),
    findFirst: vi.fn().mockResolvedValue(createNoteRow()),
    findMany: vi.fn().mockResolvedValue([createNoteRow()]),
    count: vi.fn().mockResolvedValue(1),
    update: vi.fn().mockResolvedValue(createNoteRow()),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    delete: vi.fn().mockResolvedValue({}),
  };
  const scan = {
    findFirst: vi.fn().mockResolvedValue({ projectId: PROJECT_ID, modelVersion: 1 }),
    update: vi.fn().mockResolvedValue({}),
  };
  const project = {
    update: vi.fn().mockResolvedValue({}),
  };
  const transaction = vi.fn(async (operation: unknown) => {
    if (Array.isArray(operation)) {
      return Promise.all(operation);
    }

    return (
      operation as (client: {
        note: typeof note;
        scan: typeof scan;
        project: typeof project;
      }) => Promise<unknown>
    )({ note, scan, project });
  });
  const client = {
    note,
    scan,
    project,
    $transaction: transaction,
  } as unknown as Pick<PrismaClient, 'note' | 'scan' | 'project' | '$transaction'>;

  return { client, note, scan, project, transaction };
}

describe('PrismaNoteRepository', () => {
  it('resolves a scan context with project and model version', async () => {
    const { client, scan } = createClient();
    const repository = new PrismaNoteRepository(client);

    const result = await repository.findScanContext(SCAN_ID);

    expect(result).toEqual({ projectId: PROJECT_ID, modelVersion: 1 });
    expect(scan.findFirst).toHaveBeenCalledWith({
      where: { id: SCAN_ID, deletedAt: null, project: { deletedAt: null } },
      select: { projectId: true, modelVersion: true },
    });
  });

  it('returns null when the scan is missing or deleted', async () => {
    const { client, scan } = createClient();
    scan.findFirst.mockResolvedValueOnce(null);
    const repository = new PrismaNoteRepository(client);

    await expect(repository.findScanContext(SCAN_ID)).resolves.toBeNull();
  });

  it('resolves a note context through its scan', async () => {
    const { client, note } = createClient();
    const repository = new PrismaNoteRepository(client);

    const result = await repository.findNoteContext(NOTE_ID);

    expect(result).toEqual({ projectId: PROJECT_ID, modelVersion: 1 });
    expect(note.findFirst).toHaveBeenCalledWith({
      where: {
        id: NOTE_ID,
        scan: {
          deletedAt: null,
          project: { deletedAt: null },
        },
      },
      select: {
        scan: {
          select: {
            projectId: true,
            modelVersion: true,
          },
        },
      },
    });
  });

  it('creates a note and touches scan and project activity', async () => {
    const { client, note, scan, project } = createClient();
    note.create.mockResolvedValueOnce(createNoteRow({ orientation: null }));
    const repository = new PrismaNoteRepository(client);

    const result = await repository.create(SCAN_ID, OWNER_ID, {
      content: 'Cabinet hinge is loose',
      color: 'YELLOW',
      position: { x: 1.5, y: -2, z: 3.25 },
      orientation: null,
      modelVersion: '1',
    });

    const [createArguments] = note.create.mock.calls[0] as unknown as [
      { data: Record<string, unknown> },
    ];
    expect(createArguments.data).toMatchObject({
      scanId: SCAN_ID,
      createdById: OWNER_ID,
      content: 'Cabinet hinge is loose',
      color: 'YELLOW',
      position: { x: 1.5, y: -2, z: 3.25 },
      orientation: Prisma.JsonNull,
      modelVersion: '1',
    });
    expect(scan.update).toHaveBeenCalledOnce();
    expect(project.update).toHaveBeenCalledOnce();
    expect(result.id).toBe(NOTE_ID);
    expect(result.position).toEqual({ x: 1.5, y: -2, z: 3.25 });
    expect(result.orientation).toBeNull();
  });

  it('persists a vector orientation as JSON', async () => {
    const { client, note } = createClient();
    const repository = new PrismaNoteRepository(client);

    await repository.create(SCAN_ID, OWNER_ID, {
      content: 'Note with orientation',
      color: 'BLUE',
      position: { x: 0, y: 1, z: 2 },
      orientation: { x: 0, y: 0, z: 1 },
      modelVersion: '1',
    });

    expect(note.create).toHaveBeenCalledTimes(1);
    const createCall = note.create.mock.calls[0]?.[0] as
      { data: { orientation: unknown } } | undefined;
    expect(createCall?.data.orientation).toEqual({ x: 0, y: 0, z: 1 });
  });

  it('lists notes for a scan with pagination and stable sorting', async () => {
    const { client, note } = createClient();
    note.count.mockResolvedValue(3);
    const repository = new PrismaNoteRepository(client);

    const result = await repository.listByScan(SCAN_ID, {
      page: 1,
      limit: 20,
      sort: 'updatedAt:desc',
    });

    expect(note.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { scanId: SCAN_ID, deletedAt: null, scan: { deletedAt: null } },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: 0,
        take: 20,
      }),
    );
    expect(note.count).toHaveBeenCalledWith({
      where: { scanId: SCAN_ID, deletedAt: null, scan: { deletedAt: null } },
    });
    expect(result.total).toBe(3);
    expect(result.items).toHaveLength(1);
  });

  it('rejects a stored null position as an invalid vector', async () => {
    const { client, note } = createClient();
    note.findMany.mockResolvedValueOnce([createNoteRow({ position: null })]);
    const repository = new PrismaNoteRepository(client);

    await expect(
      repository.listByScan(SCAN_ID, {
        page: 1,
        limit: 20,
        sort: 'updatedAt:desc',
      }),
    ).rejects.toThrow('Stored note position is not a valid vector');
  });

  it('finds a note the Owner can view in one lookup', async () => {
    const { client, note } = createClient();
    const repository = new PrismaNoteRepository(client);

    const result = await repository.findByIdForUser(NOTE_ID, OWNER_ID);

    expect(result).toMatchObject({ record: { id: NOTE_ID }, role: 'OWNER' });
    expect(note.findFirst).toHaveBeenCalledWith({
      where: {
        id: NOTE_ID,
        deletedAt: null,
        scan: {
          deletedAt: null,
          project: {
            deletedAt: null,
            OR: [
              { ownerId: OWNER_ID },
              {
                accesses: {
                  some: {
                    userId: OWNER_ID,
                    role: 'VIEWER',
                    revokedAt: null,
                  },
                },
              },
            ],
          },
        },
      },
      select: {
        ...noteSelect,
        scan: { select: { project: { select: { ownerId: true } } } },
      },
    });
  });

  it('returns Viewer for an active Viewer note lookup', async () => {
    const { client, note } = createClient();
    note.findFirst.mockResolvedValueOnce(createNoteRow());
    const repository = new PrismaNoteRepository(client);

    const result = await repository.findByIdForUser(NOTE_ID, VIEWER_ID);

    expect(result).toMatchObject({ role: 'VIEWER' });
  });

  it('returns null when note detail is absent or inaccessible', async () => {
    const { client, note } = createClient();
    note.findFirst.mockResolvedValueOnce(null);
    const repository = new PrismaNoteRepository(client);

    const result = await repository.findByIdForUser(NOTE_ID, VIEWER_ID);

    expect(result).toBeNull();
  });

  it('updates content and color as the Owner and touches activity', async () => {
    const { client, note, scan, project } = createClient();
    note.findFirst.mockResolvedValueOnce({ scanId: SCAN_ID });
    note.update.mockResolvedValueOnce(createNoteRow({ content: 'Updated content' }));
    const repository = new PrismaNoteRepository(client);

    const result = await repository.update(NOTE_ID, OWNER_ID, {
      content: 'Updated content',
    });

    expect(note.update).toHaveBeenCalledWith({
      where: { id: NOTE_ID },
      data: { content: 'Updated content' },
      select: noteSelect,
    });
    expect(scan.update).toHaveBeenCalledOnce();
    expect(project.update).toHaveBeenCalledOnce();
    expect(result.content).toBe('Updated content');
  });

  it('hides update from a Viewer or unrelated user', async () => {
    const { client, note } = createClient();
    note.findFirst.mockResolvedValueOnce(null);
    const repository = new PrismaNoteRepository(client);

    await expect(repository.update(NOTE_ID, VIEWER_ID, { color: 'RED' })).rejects.toBeInstanceOf(
      NoteNotFoundError,
    );
    expect(note.update).not.toHaveBeenCalled();
  });

  it('moves a note to a new position as the Owner', async () => {
    const { client, note } = createClient();
    note.findFirst.mockResolvedValueOnce({ scanId: SCAN_ID });
    note.update.mockResolvedValueOnce(
      createNoteRow({ position: { x: 9, y: 8, z: 7 }, orientation: null }),
    );
    const repository = new PrismaNoteRepository(client);

    const result = await repository.updatePosition(NOTE_ID, OWNER_ID, {
      position: { x: 9, y: 8, z: 7 },
      orientation: null,
      modelVersion: '1',
    });

    expect(note.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          position: { x: 9, y: 8, z: 7 },
          orientation: Prisma.JsonNull,
          modelVersion: '1',
        },
      }),
    );
    expect(result.position).toEqual({ x: 9, y: 8, z: 7 });
  });

  it('deletes a note as the Owner and touches activity', async () => {
    const { client, note, scan, project } = createClient();
    note.findFirst.mockResolvedValueOnce({ scanId: SCAN_ID });
    const repository = new PrismaNoteRepository(client);

    await repository.delete(NOTE_ID, OWNER_ID);

    expect(note.delete).toHaveBeenCalledWith({ where: { id: NOTE_ID } });
    expect(scan.update).toHaveBeenCalledOnce();
    expect(project.update).toHaveBeenCalledOnce();
  });

  it('soft-deletes a note with an atomic revision predicate', async () => {
    const { client, note } = createClient();
    note.findFirst.mockResolvedValueOnce(createNoteRow({ revision: 3, deletedAt: null }));
    const repository = new PrismaNoteRepository(client, {} as unknown as PrismaIdempotencyExecutor);

    await expect(repository.delete(NOTE_ID, OWNER_ID, 3)).resolves.toBe(4);

    expect(note.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: NOTE_ID,
          revision: 3,
          deletedAt: null,
          scan: { project: { ownerId: OWNER_ID } },
        },
      }),
    );
  });

  it('hides deletion from a Viewer or unrelated user', async () => {
    const { client, note } = createClient();
    note.findFirst.mockResolvedValueOnce(null);
    const repository = new PrismaNoteRepository(client);

    await expect(repository.delete(NOTE_ID, VIEWER_ID)).rejects.toBeInstanceOf(NoteNotFoundError);
    expect(note.delete).not.toHaveBeenCalled();
  });
});
