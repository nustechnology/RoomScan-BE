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
    findMany: vi.fn().mockResolvedValue([createAssetRow()]),
  };
  const client = {
    scanAsset,
    $transaction: vi.fn(),
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
});
