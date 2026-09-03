import { describe, expect, it, vi } from 'vitest';

import { Prisma, type PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaScanAssetRepository } from '../src/infrastructure/database/prisma-scan-asset-repository.js';
import type { PrismaIdempotencyExecutor } from '../src/infrastructure/database/prisma-idempotency.js';

const SCAN_ID = 'f1e2d3c4-a5b6-7890-abcd-ef1234567890';
const ASSET_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const NOW = new Date('2026-07-29T10:00:00.000Z');

const scanAssetSelect = {
  id: true,
  scanId: true,
  assetType: true,
  status: true,
  contentType: true,
  sizeBytes: true,
  checksum: true,
  modelVersion: true,
  storageKey: true,
  idempotencyKey: true,
  uploadedAt: true,
  uploadUrlExpiresAt: true,
  createdAt: true,
  updatedAt: true,
};

const activeScanAssetSelect = {
  ...scanAssetSelect,
  revision: true,
  deletedAt: true,
};

function createAssetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ASSET_ID,
    scanId: SCAN_ID,
    assetType: 'MODEL',
    status: 'PENDING',
    contentType: 'model/gltf-binary',
    sizeBytes: 1024,
    checksum: 'abc123',
    modelVersion: '1',
    storageKey: `scans/${SCAN_ID}/model`,
    idempotencyKey: null,
    uploadedAt: null,
    uploadUrlExpiresAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function createClient() {
  const scanAsset = {
    findUnique: vi.fn().mockResolvedValue(createAssetRow()),
    findFirst: vi.fn().mockResolvedValue(createAssetRow()),
    create: vi.fn().mockResolvedValue(createAssetRow()),
    update: vi.fn().mockResolvedValue(createAssetRow()),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    findMany: vi.fn().mockResolvedValue([createAssetRow()]),
  };
  const client = {
    scanAsset,
    $transaction: vi.fn(async (operation: unknown) => {
      if (typeof operation !== 'function') return undefined;
      return (operation as (transaction: unknown) => Promise<unknown>)({ scanAsset });
    }),
  } as unknown as Pick<PrismaClient, 'scanAsset' | '$transaction'>;

  return { client, scanAsset };
}

describe('PrismaScanAssetRepository', () => {
  it('finds an active asset by id', async () => {
    const { client, scanAsset } = createClient();
    const repository = new PrismaScanAssetRepository(client);

    const result = await repository.findById(ASSET_ID);

    expect(scanAsset.findFirst).toHaveBeenCalledWith({
      where: { id: ASSET_ID, deletedAt: null },
      select: activeScanAssetSelect,
    });
    expect(result?.id).toBe(ASSET_ID);
    expect(result?.status).toBe('PENDING');
  });

  it('finds an active asset by scan and type', async () => {
    const { client, scanAsset } = createClient();
    const repository = new PrismaScanAssetRepository(client);

    const result = await repository.findByScanAndType(SCAN_ID, 'MODEL');

    expect(scanAsset.findFirst).toHaveBeenCalledWith({
      where: { scanId: SCAN_ID, assetType: 'MODEL', deletedAt: null },
      select: activeScanAssetSelect,
    });
    expect(result?.assetType).toBe('MODEL');
  });

  it('creates an asset row in PENDING state and reports a fresh insert', async () => {
    const { client, scanAsset } = createClient();
    const repository = new PrismaScanAssetRepository(client);

    const result = await repository.create({
      scanId: SCAN_ID,
      assetType: 'MODEL',
      contentType: 'model/gltf-binary',
      sizeBytes: 1024,
      checksum: 'abc123',
      modelVersion: '1',
      storageKey: `scans/${SCAN_ID}/model`,
      idempotencyKey: 'mutation-1',
      uploadUrlExpiresAt: NOW,
    });

    expect(scanAsset.create).toHaveBeenCalledWith({
      data: {
        scanId: SCAN_ID,
        assetType: 'MODEL',
        status: 'PENDING',
        contentType: 'model/gltf-binary',
        sizeBytes: 1024,
        checksum: 'abc123',
        modelVersion: '1',
        storageKey: `scans/${SCAN_ID}/model`,
        idempotencyKey: 'mutation-1',
        uploadUrlExpiresAt: NOW,
      },
      select: scanAssetSelect,
    });
    expect(result.created).toBe(true);
    expect(result.record.id).toBe(ASSET_ID);
  });

  it('resolves a concurrent duplicate insert to the existing session as not created', async () => {
    const { client, scanAsset } = createClient();
    const conflict = new Prisma.PrismaClientKnownRequestError('unique constraint', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['scanId', 'assetType'] },
    });
    scanAsset.create.mockRejectedValueOnce(conflict);
    scanAsset.findUnique.mockResolvedValueOnce(createAssetRow({ id: ASSET_ID }));
    const repository = new PrismaScanAssetRepository(client);

    const result = await repository.create({
      scanId: SCAN_ID,
      assetType: 'MODEL',
      contentType: 'model/gltf-binary',
      sizeBytes: 1024,
      checksum: 'abc123',
      modelVersion: '1',
      storageKey: `scans/${SCAN_ID}/model`,
      idempotencyKey: null,
      uploadUrlExpiresAt: NOW,
    });

    expect(scanAsset.findUnique).toHaveBeenCalledWith({
      where: { scanId_assetType: { scanId: SCAN_ID, assetType: 'MODEL' } },
      select: scanAssetSelect,
    });
    expect(result.created).toBe(false);
    expect(result.record.id).toBe(ASSET_ID);
  });

  it('rethrows non-duplicate errors from create', async () => {
    const { client, scanAsset } = createClient();
    scanAsset.create.mockRejectedValueOnce(new Error('boom'));
    const repository = new PrismaScanAssetRepository(client);

    await expect(
      repository.create({
        scanId: SCAN_ID,
        assetType: 'MODEL',
        contentType: 'model/gltf-binary',
        sizeBytes: 1024,
        checksum: 'abc123',
        modelVersion: '1',
        storageKey: `scans/${SCAN_ID}/model`,
        idempotencyKey: null,
        uploadUrlExpiresAt: NOW,
      }),
    ).rejects.toThrow('boom');
    expect(scanAsset.findUnique).not.toHaveBeenCalled();
  });

  it('updates an asset', async () => {
    const { client, scanAsset } = createClient();
    const repository = new PrismaScanAssetRepository(client);

    await repository.update(ASSET_ID, { status: 'UPLOADED', uploadedAt: NOW });

    expect(scanAsset.update).toHaveBeenCalledWith({
      where: { id: ASSET_ID },
      data: { status: 'UPLOADED', uploadedAt: NOW },
      select: scanAssetSelect,
    });
  });

  it('persists the thumbnail URL on the scan inside the asset update transaction', async () => {
    const scanAssetUpdate = vi.fn().mockResolvedValue(createAssetRow({ assetType: 'THUMBNAIL' }));
    const scanUpdate = vi.fn().mockResolvedValue({});
    const scanFindFirst = vi.fn().mockResolvedValue(null);
    const transactionClient = {
      scanAsset: { update: scanAssetUpdate },
      scan: { update: scanUpdate, findFirst: scanFindFirst },
    };
    const $transaction = vi.fn(async (operation: unknown) => {
      if (Array.isArray(operation)) {
        return Promise.all(operation);
      }
      return (operation as (transaction: unknown) => Promise<unknown>)(transactionClient);
    });
    const client = {
      scanAsset: {},
      $transaction,
    } as unknown as Pick<PrismaClient, 'scanAsset' | '$transaction'>;
    const repository = new PrismaScanAssetRepository(client, {} as PrismaIdempotencyExecutor);

    await repository.update(ASSET_ID, {
      status: 'UPLOADED',
      uploadedAt: NOW,
      thumbnailUrl: 'http://storage/display/thumbnail',
    });

    const [assetUpdate] = scanAssetUpdate.mock.calls[0] as unknown as [
      { data: Record<string, unknown> },
    ];
    expect(assetUpdate.data).toMatchObject({ status: 'UPLOADED', uploadedAt: NOW });
    expect(assetUpdate.data).not.toHaveProperty('thumbnailUrl');

    const [scanUpdateArg] = scanUpdate.mock.calls[0] as unknown as [
      { where: { id: string }; data: { thumbnail: string; updatedAt: Date } },
    ];
    expect(scanUpdateArg.where).toEqual({ id: SCAN_ID });
    expect(scanUpdateArg.data.thumbnail).toBe('http://storage/display/thumbnail');
    expect(scanUpdateArg.data.updatedAt).toBeInstanceOf(Date);
  });

  it('lists assets by scan with stable ordering', async () => {
    const { client, scanAsset } = createClient();
    const repository = new PrismaScanAssetRepository(client);

    const result = await repository.listByScan(SCAN_ID);

    expect(scanAsset.findMany).toHaveBeenCalledWith({
      where: { scanId: SCAN_ID },
      orderBy: [{ assetType: 'asc' }, { id: 'asc' }],
      select: scanAssetSelect,
    });
    expect(result).toHaveLength(1);
  });

  it('creates an asset and rolls up the scan in a transaction when idempotency is configured', async () => {
    const scanAssetCreate = vi
      .fn()
      .mockResolvedValue(createAssetRow({ revision: 1, deletedAt: null }));
    const scan = {
      findFirst: vi.fn().mockResolvedValue({ projectId: 'project-id' }),
      update: vi.fn().mockResolvedValue({}),
    };
    const project = { update: vi.fn().mockResolvedValue({}) };
    const $transaction = vi.fn(async (operation: unknown) => {
      return (operation as (tx: unknown) => Promise<unknown>)({
        scanAsset: { create: scanAssetCreate },
        scan,
        project,
      });
    });
    const client = {
      scanAsset: { create: scanAssetCreate },
      $transaction,
    } as unknown as Pick<PrismaClient, 'scanAsset' | '$transaction'>;
    const repository = new PrismaScanAssetRepository(client, {} as PrismaIdempotencyExecutor);

    const result = await repository.create({
      scanId: SCAN_ID,
      assetType: 'MODEL',
      contentType: 'model/gltf-binary',
      sizeBytes: 1024,
      checksum: 'abc123',
      modelVersion: '1',
      storageKey: `scans/${SCAN_ID}/model`,
      idempotencyKey: null,
      uploadUrlExpiresAt: NOW,
    });

    expect(scanAssetCreate).toHaveBeenCalledWith(
      expect.objectContaining({ select: activeScanAssetSelect }),
    );
    expect(result.created).toBe(true);
    expect(result.record.id).toBe(ASSET_ID);
  });

  it('resolves a concurrent duplicate insert during idempotent create to the existing row', async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError('unique constraint', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['scanId', 'assetType'] },
    });
    const $transaction = vi.fn().mockRejectedValue(conflict);
    const findUnique = vi.fn().mockResolvedValue(createAssetRow({ revision: 1, deletedAt: null }));
    const client = {
      scanAsset: { findUnique },
      $transaction,
    } as unknown as Pick<PrismaClient, 'scanAsset' | '$transaction'>;
    const repository = new PrismaScanAssetRepository(client, {} as PrismaIdempotencyExecutor);

    const result = await repository.create({
      scanId: SCAN_ID,
      assetType: 'MODEL',
      contentType: 'model/gltf-binary',
      sizeBytes: 1024,
      checksum: 'abc123',
      modelVersion: '1',
      storageKey: `scans/${SCAN_ID}/model`,
      idempotencyKey: null,
      uploadUrlExpiresAt: NOW,
    });

    expect(findUnique).toHaveBeenCalledWith({
      where: { scanId_assetType: { scanId: SCAN_ID, assetType: 'MODEL' } },
      select: activeScanAssetSelect,
    });
    expect(result.created).toBe(false);
    expect(result.record.id).toBe(ASSET_ID);
  });

  it('creates a new asset session inside an idempotent save', async () => {
    const scanAssetCreate = vi.fn().mockResolvedValue({ id: ASSET_ID });
    const tx = {
      scanAsset: { create: scanAssetCreate },
      scan: {
        findFirst: vi.fn().mockResolvedValue({ projectId: 'project-id' }),
        update: vi.fn().mockResolvedValue({}),
      },
      project: { update: vi.fn().mockResolvedValue({}) },
    };
    const execute = vi.fn(
      async (_context: unknown, statusCode: number, work: (t: unknown) => Promise<unknown>) => ({
        body: await work(tx),
        statusCode,
        replayed: false,
      }),
    );
    const repository = new PrismaScanAssetRepository(
      {} as Pick<PrismaClient, 'scanAsset' | '$transaction'>,
      { execute } as unknown as PrismaIdempotencyExecutor,
    );
    const context = {
      userId: 'user-id',
      operation: 'CREATE_UPLOAD_SESSION' as const,
      parentScope: `scan:${SCAN_ID}`,
      keyHash: 'key-hash',
      requestHash: 'request-hash',
    };
    const result = {
      uploadSessionId: ASSET_ID,
      assetId: ASSET_ID,
      assetType: 'MODEL' as const,
      status: 'PENDING' as const,
      uploadUrl: 'https://storage/upload',
      uploadUrlExpiresAt: NOW.toISOString(),
      created: true,
    };

    const outcome = await repository.saveUploadSessionIdempotently(
      null,
      {
        scanId: SCAN_ID,
        assetType: 'MODEL',
        contentType: 'model/gltf-binary',
        sizeBytes: 1024,
        checksum: 'abc123',
        modelVersion: '1',
        storageKey: `scans/${SCAN_ID}/model`,
        idempotencyKey: null,
        uploadUrlExpiresAt: NOW,
      },
      context,
      result,
      false,
    );

    expect(execute).toHaveBeenCalledWith(context, 201, expect.any(Function));
    expect(scanAssetCreate).toHaveBeenCalledWith(expect.objectContaining({ select: { id: true } }));
    expect(outcome.body.assetId).toBe(ASSET_ID);
  });

  it('updates an existing asset session inside an idempotent save', async () => {
    const scanAssetUpdate = vi.fn().mockResolvedValue({ id: ASSET_ID });
    const tx = {
      scanAsset: { update: scanAssetUpdate },
      scan: {
        findFirst: vi.fn().mockResolvedValue({ projectId: 'project-id' }),
        update: vi.fn().mockResolvedValue({}),
      },
      project: { update: vi.fn().mockResolvedValue({}) },
    };
    const execute = vi.fn(
      async (_context: unknown, statusCode: number, work: (t: unknown) => Promise<unknown>) => ({
        body: await work(tx),
        statusCode,
        replayed: false,
      }),
    );
    const repository = new PrismaScanAssetRepository(
      {} as Pick<PrismaClient, 'scanAsset' | '$transaction'>,
      { execute } as unknown as PrismaIdempotencyExecutor,
    );
    const context = {
      userId: 'user-id',
      operation: 'CREATE_UPLOAD_SESSION' as const,
      parentScope: `scan:${SCAN_ID}`,
      keyHash: 'key-hash',
      requestHash: 'request-hash',
    };
    const result = {
      uploadSessionId: ASSET_ID,
      assetId: ASSET_ID,
      assetType: 'MODEL' as const,
      status: 'PENDING' as const,
      uploadUrl: 'https://storage/upload',
      uploadUrlExpiresAt: NOW.toISOString(),
      created: false,
    };

    const outcome = await repository.saveUploadSessionIdempotently(
      ASSET_ID,
      {
        scanId: SCAN_ID,
        assetType: 'MODEL',
        contentType: 'model/gltf-binary',
        sizeBytes: 1024,
        checksum: 'abc123',
        modelVersion: '1',
        storageKey: `scans/${SCAN_ID}/model`,
        idempotencyKey: null,
        uploadUrlExpiresAt: NOW,
      },
      context,
      result,
      false,
    );

    expect(execute).toHaveBeenCalledWith(context, 200, expect.any(Function));
    expect(scanAssetUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ASSET_ID } }),
    );
    expect(outcome.body.assetId).toBe(ASSET_ID);
  });

  it('returns the result untouched when reuseWithoutMutation is true', async () => {
    const execute = vi.fn(
      async (_context: unknown, statusCode: number, work: (t: unknown) => Promise<unknown>) => ({
        body: await work({}),
        statusCode,
        replayed: false,
      }),
    );
    const repository = new PrismaScanAssetRepository(
      {} as Pick<PrismaClient, 'scanAsset' | '$transaction'>,
      { execute } as unknown as PrismaIdempotencyExecutor,
    );
    const context = {
      userId: 'user-id',
      operation: 'CREATE_UPLOAD_SESSION' as const,
      parentScope: `scan:${SCAN_ID}`,
      keyHash: 'key-hash',
      requestHash: 'request-hash',
    };
    const result = {
      uploadSessionId: ASSET_ID,
      assetId: ASSET_ID,
      assetType: 'MODEL' as const,
      status: 'PENDING' as const,
      uploadUrl: 'https://storage/upload',
      uploadUrlExpiresAt: NOW.toISOString(),
      created: true,
    };

    const outcome = await repository.saveUploadSessionIdempotently(
      null,
      {
        scanId: SCAN_ID,
        assetType: 'MODEL',
        contentType: 'model/gltf-binary',
        sizeBytes: 1024,
        checksum: 'abc123',
        modelVersion: '1',
        storageKey: `scans/${SCAN_ID}/model`,
        idempotencyKey: null,
        uploadUrlExpiresAt: NOW,
      },
      context,
      result,
      true,
    );

    expect(outcome.body).toBe(result);
  });

  it('rejects an idempotent save when idempotency is not configured', async () => {
    const repository = new PrismaScanAssetRepository(
      {} as Pick<PrismaClient, 'scanAsset' | '$transaction'>,
    );

    await expect(
      repository.saveUploadSessionIdempotently(
        null,
        {
          scanId: SCAN_ID,
          assetType: 'MODEL',
          contentType: 'model/gltf-binary',
          sizeBytes: 1024,
          checksum: 'abc123',
          modelVersion: '1',
          storageKey: `scans/${SCAN_ID}/model`,
          idempotencyKey: null,
          uploadUrlExpiresAt: NOW,
        },
        {
          userId: 'user-id',
          operation: 'CREATE_UPLOAD_SESSION',
          parentScope: `scan:${SCAN_ID}`,
          keyHash: 'key-hash',
          requestHash: 'request-hash',
        },
        {
          uploadSessionId: ASSET_ID,
          assetId: ASSET_ID,
          assetType: 'MODEL',
          status: 'PENDING',
          uploadUrl: 'https://storage/upload',
          uploadUrlExpiresAt: NOW.toISOString(),
          created: true,
        },
        false,
      ),
    ).rejects.toThrow('Scan asset idempotency is not configured');
  });

  it('updates an asset in a transaction without setting a thumbnail when none is provided', async () => {
    const scanAssetUpdate = vi
      .fn()
      .mockResolvedValue(createAssetRow({ revision: 1, deletedAt: null }));
    const scanUpdate = vi.fn().mockResolvedValue({});
    const tx = {
      scanAsset: { update: scanAssetUpdate },
      scan: {
        findFirst: vi.fn().mockResolvedValue({ projectId: 'project-id' }),
        update: scanUpdate,
      },
      project: { update: vi.fn().mockResolvedValue({}) },
    };
    const $transaction = vi.fn(async (operation: unknown) => {
      return (operation as (t: unknown) => Promise<unknown>)(tx);
    });
    const client = {
      scanAsset: { update: scanAssetUpdate },
      $transaction,
    } as unknown as Pick<PrismaClient, 'scanAsset' | '$transaction'>;
    const repository = new PrismaScanAssetRepository(client, {} as PrismaIdempotencyExecutor);

    const result = await repository.update(ASSET_ID, { status: 'UPLOADED', uploadedAt: NOW });

    expect(scanAssetUpdate).toHaveBeenCalledWith({
      where: { id: ASSET_ID },
      data: {
        status: 'UPLOADED',
        uploadedAt: NOW,
        revision: { increment: 1 },
        updatedAt: expect.any(Date) as Date,
      },
      select: activeScanAssetSelect,
    });
    expect(scanUpdate).toHaveBeenCalledWith({
      where: { id: SCAN_ID },
      data: { updatedAt: expect.any(Date) as Date },
    });
    const scanUpdateData = (
      scanUpdate.mock.calls[0]?.[0] as { data: { thumbnail?: unknown } } | undefined
    )?.data;
    expect(scanUpdateData?.thumbnail).toBeUndefined();
    expect(result.status).toBe('PENDING');
  });

  it('lists only active assets when idempotency is configured', async () => {
    const scanAsset = {
      findMany: vi.fn().mockResolvedValue([createAssetRow({ revision: 1, deletedAt: null })]),
    };
    const client = {
      scanAsset,
      $transaction: vi.fn(),
    } as unknown as Pick<PrismaClient, 'scanAsset' | '$transaction'>;
    const repository = new PrismaScanAssetRepository(client, {} as PrismaIdempotencyExecutor);

    const result = await repository.listByScan(SCAN_ID);

    expect(scanAsset.findMany).toHaveBeenCalledWith({
      where: { scanId: SCAN_ID, deletedAt: null },
      orderBy: [{ assetType: 'asc' }, { id: 'asc' }],
      select: activeScanAssetSelect,
    });
    expect(result).toHaveLength(1);
  });

  describe('updateGuarded', () => {
    it('applies the update when the current status matches', async () => {
      const { client, scanAsset } = createClient();
      const repository = new PrismaScanAssetRepository(client);

      const result = await repository.updateGuarded(ASSET_ID, ['PENDING', 'UPLOADING'], {
        status: 'FAILED',
      });

      expect(scanAsset.updateMany).toHaveBeenCalledWith({
        where: { id: ASSET_ID, status: { in: ['PENDING', 'UPLOADING'] } },
        data: { status: 'FAILED' },
      });
      expect(scanAsset.findUnique).toHaveBeenCalledWith({
        where: { id: ASSET_ID },
        select: scanAssetSelect,
      });
      expect(result?.id).toBe(ASSET_ID);
    });

    it('returns null when the current status no longer matches', async () => {
      const { client, scanAsset } = createClient();
      scanAsset.updateMany.mockResolvedValueOnce({ count: 0 });
      const repository = new PrismaScanAssetRepository(client);

      const result = await repository.updateGuarded(ASSET_ID, ['PENDING', 'UPLOADING'], {
        status: 'FAILED',
      });

      expect(scanAsset.findUnique).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('applies a guarded update and rolls up the scan when idempotency is configured', async () => {
      const scanAssetUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
      const scanAssetFindUniqueOrThrow = vi
        .fn()
        .mockResolvedValue(createAssetRow({ revision: 2, deletedAt: null }));
      const scanFindFirst = vi.fn().mockResolvedValue({ projectId: 'project-id' });
      const scanUpdate = vi.fn().mockResolvedValue({});
      const projectUpdate = vi.fn().mockResolvedValue({});
      const tx = {
        scanAsset: {
          updateMany: scanAssetUpdateMany,
          findUniqueOrThrow: scanAssetFindUniqueOrThrow,
        },
        scan: { findFirst: scanFindFirst, update: scanUpdate },
        project: { update: projectUpdate },
      };
      const $transaction = vi.fn(async (operation: unknown) => {
        return (operation as (t: unknown) => Promise<unknown>)(tx);
      });
      const client = {
        scanAsset: {},
        $transaction,
      } as unknown as Pick<PrismaClient, 'scanAsset' | '$transaction'>;
      const repository = new PrismaScanAssetRepository(client, {} as PrismaIdempotencyExecutor);

      const result = await repository.updateGuarded(ASSET_ID, ['PENDING', 'UPLOADING'], {
        status: 'FAILED',
      });

      expect(scanAssetUpdateMany).toHaveBeenCalledWith({
        where: { id: ASSET_ID, status: { in: ['PENDING', 'UPLOADING'] } },
        data: { status: 'FAILED', revision: { increment: 1 }, updatedAt: expect.any(Date) as Date },
      });
      expect(scanUpdate).toHaveBeenCalledWith({
        where: { id: SCAN_ID },
        data: { updatedAt: expect.any(Date) as Date },
      });
      expect(result?.revision).toBe(2);
    });

    it('returns null inside a transaction when a concurrent writer already moved the row', async () => {
      const scanAssetUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
      const scanAssetFindUniqueOrThrow = vi.fn();
      const tx = {
        scanAsset: {
          updateMany: scanAssetUpdateMany,
          findUniqueOrThrow: scanAssetFindUniqueOrThrow,
        },
      };
      const $transaction = vi.fn(async (operation: unknown) => {
        return (operation as (t: unknown) => Promise<unknown>)(tx);
      });
      const client = {
        scanAsset: {},
        $transaction,
      } as unknown as Pick<PrismaClient, 'scanAsset' | '$transaction'>;
      const repository = new PrismaScanAssetRepository(client, {} as PrismaIdempotencyExecutor);

      const result = await repository.updateGuarded(ASSET_ID, ['PENDING', 'UPLOADING'], {
        status: 'FAILED',
      });

      expect(scanAssetFindUniqueOrThrow).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });
  });

  describe('failStuckUploadSessions', () => {
    it('bulk-fails stuck sessions past the cutoff when idempotency is not configured', async () => {
      const { client, scanAsset } = createClient();
      const repository = new PrismaScanAssetRepository(client);
      const cutoff = new Date('2026-07-29T09:00:00.000Z');

      const count = await repository.failStuckUploadSessions(cutoff, 200);

      expect(scanAsset.updateMany).toHaveBeenCalledWith({
        where: {
          status: { in: ['PENDING', 'UPLOADING'] },
          uploadUrlExpiresAt: { not: null, lte: cutoff },
        },
        data: { status: 'FAILED' },
      });
      expect(count).toBe(1);
    });

    it('guards each candidate individually when idempotency is configured', async () => {
      const cutoff = new Date('2026-07-29T09:00:00.000Z');
      const { client, scanAsset } = createClient();
      scanAsset.findMany.mockResolvedValueOnce([{ id: ASSET_ID }, { id: 'other-id' }]);
      const repository = new PrismaScanAssetRepository(client, {} as PrismaIdempotencyExecutor);
      const guardedSpy = vi
        .spyOn(repository, 'updateGuarded')
        .mockResolvedValueOnce(createAssetRow() as never)
        .mockResolvedValueOnce(null);

      const count = await repository.failStuckUploadSessions(cutoff, 200);

      expect(scanAsset.findMany).toHaveBeenCalledWith({
        where: {
          deletedAt: null,
          status: { in: ['PENDING', 'UPLOADING'] },
          uploadUrlExpiresAt: { not: null, lte: cutoff },
        },
        orderBy: { id: 'asc' },
        take: 200,
        select: { id: true },
      });
      expect(guardedSpy).toHaveBeenCalledTimes(2);
      expect(guardedSpy).toHaveBeenCalledWith(ASSET_ID, ['PENDING', 'UPLOADING'], {
        status: 'FAILED',
      });
      expect(count).toBe(1);
    });

    it('repeats the query/update cycle across multiple full batches', async () => {
      const cutoff = new Date('2026-07-29T09:00:00.000Z');
      const { client, scanAsset } = createClient();
      scanAsset.findMany
        .mockResolvedValueOnce([{ id: 'asset-1' }, { id: 'asset-2' }])
        .mockResolvedValueOnce([{ id: 'asset-3' }]);
      const repository = new PrismaScanAssetRepository(client, {} as PrismaIdempotencyExecutor);
      const guardedSpy = vi
        .spyOn(repository, 'updateGuarded')
        .mockResolvedValue(createAssetRow() as never);

      const count = await repository.failStuckUploadSessions(cutoff, 2);

      expect(scanAsset.findMany).toHaveBeenCalledTimes(2);
      expect(guardedSpy).toHaveBeenCalledTimes(3);
      expect(count).toBe(3);
    });
  });

  describe('listOrphanCandidates', () => {
    it('lists FAILED and stuck rows oldest-first, bounded by the limit', async () => {
      const { client, scanAsset } = createClient();
      const repository = new PrismaScanAssetRepository(client);
      const cutoff = new Date('2026-07-29T09:00:00.000Z');

      const result = await repository.listOrphanCandidates(cutoff, 200);

      expect(scanAsset.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { status: 'FAILED' },
            {
              status: { in: ['PENDING', 'UPLOADING'] },
              uploadUrlExpiresAt: { not: null, lte: cutoff },
            },
          ],
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: 200,
        select: scanAssetSelect,
      });
      expect(result).toHaveLength(1);
    });

    it('filters out soft-deleted rows when idempotency is configured', async () => {
      const scanAsset = {
        findMany: vi.fn().mockResolvedValue([createAssetRow({ revision: 1, deletedAt: null })]),
      };
      const client = {
        scanAsset,
        $transaction: vi.fn(),
      } as unknown as Pick<PrismaClient, 'scanAsset' | '$transaction'>;
      const repository = new PrismaScanAssetRepository(client, {} as PrismaIdempotencyExecutor);
      const cutoff = new Date('2026-07-29T09:00:00.000Z');

      await repository.listOrphanCandidates(cutoff, 50);

      expect(scanAsset.findMany).toHaveBeenCalledWith({
        where: {
          deletedAt: null,
          OR: [
            { status: 'FAILED' },
            {
              status: { in: ['PENDING', 'UPLOADING'] },
              uploadUrlExpiresAt: { not: null, lte: cutoff },
            },
          ],
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: 50,
        select: activeScanAssetSelect,
      });
    });
  });

  describe('deleteOrphanAsset', () => {
    it('hard-deletes a matching row when idempotency is not configured', async () => {
      const { client, scanAsset } = createClient();
      const repository = new PrismaScanAssetRepository(client);

      const result = await repository.deleteOrphanAsset(ASSET_ID, {
        status: 'FAILED',
        uploadUrlExpiresAt: null,
      });

      expect(scanAsset.deleteMany).toHaveBeenCalledWith({
        where: { id: ASSET_ID, status: 'FAILED', uploadUrlExpiresAt: null },
      });
      expect(result).toBe(true);
    });

    it('returns false when no row matches in legacy mode', async () => {
      const { client, scanAsset } = createClient();
      scanAsset.deleteMany.mockResolvedValueOnce({ count: 0 });
      const repository = new PrismaScanAssetRepository(client);

      const result = await repository.deleteOrphanAsset(ASSET_ID, {
        status: 'FAILED',
        uploadUrlExpiresAt: null,
      });

      expect(result).toBe(false);
    });

    it('re-verifies the orphan condition, atomically claims the row, writes a delete change, and rolls up the scan', async () => {
      const scanAssetFindFirst = vi.fn().mockResolvedValue({
        id: ASSET_ID,
        scanId: SCAN_ID,
        revision: 3,
        scan: { projectId: 'project-id', project: { ownerId: 'owner-id' } },
      });
      const scanAssetDeleteMany = vi.fn().mockResolvedValue({ count: 1 });
      const scanFindFirst = vi.fn().mockResolvedValue({ projectId: 'project-id' });
      const scanUpdate = vi.fn().mockResolvedValue({});
      const projectUpdate = vi.fn().mockResolvedValue({});
      const tx = {
        scanAsset: { findFirst: scanAssetFindFirst, deleteMany: scanAssetDeleteMany },
        scan: { findFirst: scanFindFirst, update: scanUpdate },
        project: { update: projectUpdate },
      };
      const $transaction = vi.fn(async (operation: unknown) => {
        return (operation as (t: unknown) => Promise<unknown>)(tx);
      });
      const client = {
        scanAsset: {},
        $transaction,
      } as unknown as Pick<PrismaClient, 'scanAsset' | '$transaction'>;
      const repository = new PrismaScanAssetRepository(client, {} as PrismaIdempotencyExecutor);

      const result = await repository.deleteOrphanAsset(ASSET_ID, {
        status: 'FAILED',
        uploadUrlExpiresAt: null,
      });

      expect(scanAssetFindFirst).toHaveBeenCalledWith({
        where: { id: ASSET_ID, deletedAt: null, status: 'FAILED', uploadUrlExpiresAt: null },
        select: {
          id: true,
          scanId: true,
          revision: true,
          scan: { select: { projectId: true, project: { select: { ownerId: true } } } },
        },
      });
      expect(scanAssetDeleteMany).toHaveBeenCalledWith({
        where: { id: ASSET_ID, deletedAt: null, status: 'FAILED', uploadUrlExpiresAt: null },
      });
      expect(scanUpdate).toHaveBeenCalledWith({
        where: { id: SCAN_ID },
        data: { updatedAt: expect.any(Date) as Date },
      });
      expect(result).toBe(true);
    });

    it('aborts without writing a sync change when a concurrent run already claimed the row', async () => {
      const scanAssetFindFirst = vi.fn().mockResolvedValue({
        id: ASSET_ID,
        scanId: SCAN_ID,
        revision: 3,
        scan: { projectId: 'project-id', project: { ownerId: 'owner-id' } },
      });
      const scanAssetDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
      const scanUpdate = vi.fn();
      const tx = {
        scanAsset: { findFirst: scanAssetFindFirst, deleteMany: scanAssetDeleteMany },
        scan: { update: scanUpdate },
      };
      const $transaction = vi.fn(async (operation: unknown) => {
        return (operation as (t: unknown) => Promise<unknown>)(tx);
      });
      const client = {
        scanAsset: {},
        $transaction,
      } as unknown as Pick<PrismaClient, 'scanAsset' | '$transaction'>;
      const repository = new PrismaScanAssetRepository(client, {} as PrismaIdempotencyExecutor);

      const result = await repository.deleteOrphanAsset(ASSET_ID, {
        status: 'FAILED',
        uploadUrlExpiresAt: null,
      });

      expect(scanAssetDeleteMany).toHaveBeenCalledOnce();
      expect(scanUpdate).not.toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it('returns false when the row no longer matches the orphan condition inside the transaction', async () => {
      const scanAssetFindFirst = vi.fn().mockResolvedValue(null);
      const scanAssetDeleteMany = vi.fn();
      const tx = {
        scanAsset: { findFirst: scanAssetFindFirst, deleteMany: scanAssetDeleteMany },
      };
      const $transaction = vi.fn(async (operation: unknown) => {
        return (operation as (t: unknown) => Promise<unknown>)(tx);
      });
      const client = {
        scanAsset: {},
        $transaction,
      } as unknown as Pick<PrismaClient, 'scanAsset' | '$transaction'>;
      const repository = new PrismaScanAssetRepository(client, {} as PrismaIdempotencyExecutor);

      const result = await repository.deleteOrphanAsset(ASSET_ID, {
        status: 'FAILED',
        uploadUrlExpiresAt: null,
      });

      expect(scanAssetDeleteMany).not.toHaveBeenCalled();
      expect(result).toBe(false);
    });
  });
});
