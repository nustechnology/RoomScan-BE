import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import type {
  IdempotencyContext,
  IdempotencyResult,
} from '../../common/idempotency/idempotency.types.js';
import type {
  CreateUploadSessionResult,
  ScanAssetCreateData,
  ScanAssetRecord,
  ScanAssetRepository,
  ScanAssetType,
  ScanAssetUpdateData,
} from '../../modules/scan-asset/scan-asset.types.js';
import type { PrismaIdempotencyExecutor } from './prisma-idempotency.js';
import { refreshScanRollup, writeAssetUpsert } from './prisma-sync-writer.js';

const scanAssetSelect = {
  id: true,
  scanId: true,
  assetType: true,
  status: true,
  contentType: true,
  sizeBytes: true,
  checksum: true,
  modelVersion: true,
  revision: true,
  deletedAt: true,
  storageKey: true,
  idempotencyKey: true,
  uploadedAt: true,
  uploadUrlExpiresAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const legacyScanAssetSelect = {
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
} as const;

type AssetRowStatus = 'NONE' | 'PENDING' | 'UPLOADING' | 'UPLOADED' | 'FAILED';

interface ScanAssetRow {
  id: string;
  scanId: string;
  assetType: ScanAssetRecord['assetType'];
  status: AssetRowStatus;
  contentType: string;
  sizeBytes: number;
  checksum: string | null;
  modelVersion: string | null;
  revision: number;
  deletedAt: Date | null;
  storageKey: string;
  idempotencyKey: string | null;
  uploadedAt: Date | null;
  uploadUrlExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toScanAssetRecord(row: ScanAssetRow): ScanAssetRecord {
  return {
    id: row.id,
    scanId: row.scanId,
    assetType: row.assetType,
    status: row.status === 'NONE' ? 'PENDING' : row.status,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    checksum: row.checksum,
    modelVersion: row.modelVersion,
    revision: row.revision ?? 1,
    deletedAt: row.deletedAt ?? null,
    storageKey: row.storageKey,
    idempotencyKey: row.idempotencyKey,
    uploadedAt: row.uploadedAt,
    uploadUrlExpiresAt: row.uploadUrlExpiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaScanAssetRepository implements ScanAssetRepository {
  readonly managesSyncRollups = true;
  readonly #client: Pick<PrismaClient, 'scanAsset' | '$transaction'>;
  readonly #idempotency: PrismaIdempotencyExecutor | undefined;

  constructor(
    client: Pick<PrismaClient, 'scanAsset' | '$transaction'>,
    idempotency?: PrismaIdempotencyExecutor,
  ) {
    this.#client = client;
    this.#idempotency = idempotency;
  }

  async findById(id: string): Promise<ScanAssetRecord | null> {
    const row = await this.#client.scanAsset.findFirst({
      where: { id, deletedAt: null },
      select: scanAssetSelect,
    });
    return row === null ? null : toScanAssetRecord(row);
  }

  async findByScanAndType(
    scanId: string,
    assetType: ScanAssetType,
  ): Promise<ScanAssetRecord | null> {
    const row = await this.#client.scanAsset.findFirst({
      where: { scanId, assetType, deletedAt: null },
      select: scanAssetSelect,
    });
    return row === null ? null : toScanAssetRecord(row);
  }

  async create(data: ScanAssetCreateData): Promise<{ record: ScanAssetRecord; created: boolean }> {
    if (this.#idempotency === undefined) {
      try {
        const row = await this.#client.scanAsset.create({
          data: {
            ...(data.id === undefined ? {} : { id: data.id }),
            scanId: data.scanId,
            assetType: data.assetType,
            status: 'PENDING',
            contentType: data.contentType,
            sizeBytes: data.sizeBytes,
            checksum: data.checksum,
            modelVersion: data.modelVersion,
            storageKey: data.storageKey,
            idempotencyKey: data.idempotencyKey,
            uploadUrlExpiresAt: data.uploadUrlExpiresAt,
          },
          select: legacyScanAssetSelect,
        });
        return { record: toScanAssetRecord(row as ScanAssetRow), created: true };
      } catch (error) {
        if (this.#isDuplicateAsset(error)) {
          const existing = await this.#client.scanAsset.findUnique({
            where: { scanId_assetType: { scanId: data.scanId, assetType: data.assetType } },
            select: legacyScanAssetSelect,
          });
          if (existing !== null) {
            return { record: toScanAssetRecord(existing as ScanAssetRow), created: false };
          }
        }
        throw error;
      }
    }
    try {
      const row = await this.#client.$transaction(async (transaction) => {
        const now = new Date();
        const created = await transaction.scanAsset.create({
          data: {
            ...(data.id === undefined ? {} : { id: data.id }),
            scanId: data.scanId,
            assetType: data.assetType,
            status: 'PENDING',
            contentType: data.contentType,
            sizeBytes: data.sizeBytes,
            checksum: data.checksum,
            modelVersion: data.modelVersion,
            storageKey: data.storageKey,
            idempotencyKey: data.idempotencyKey,
            uploadUrlExpiresAt: data.uploadUrlExpiresAt,
            createdAt: now,
            updatedAt: now,
          },
          select: scanAssetSelect,
        });
        await writeAssetUpsert(transaction, created.id, { changedAt: now });
        await refreshScanRollup(transaction, created.scanId, now);
        return created;
      });
      return { record: toScanAssetRecord(row), created: true };
    } catch (error) {
      if (this.#isDuplicateAsset(error)) {
        const existing = await this.#client.scanAsset.findUnique({
          where: { scanId_assetType: { scanId: data.scanId, assetType: data.assetType } },
          select: scanAssetSelect,
        });

        if (existing !== null) {
          return { record: toScanAssetRecord(existing), created: false };
        }
      }

      throw error;
    }
  }

  async saveUploadSessionIdempotently(
    existingId: string | null,
    data: ScanAssetCreateData,
    context: IdempotencyContext,
    result: CreateUploadSessionResult,
    reuseWithoutMutation: boolean,
  ): Promise<IdempotencyResult<CreateUploadSessionResult>> {
    if (this.#idempotency === undefined) {
      throw new Error('Scan asset idempotency is not configured');
    }
    return await this.#idempotency.execute(
      context,
      result.created ? 201 : 200,
      async (transaction) => {
        if (!reuseWithoutMutation) {
          const changedAt = new Date();
          let assetId: string;
          if (existingId === null) {
            const created = await transaction.scanAsset.create({
              data: {
                ...(data.id === undefined ? {} : { id: data.id }),
                scanId: data.scanId,
                assetType: data.assetType,
                status: 'PENDING',
                contentType: data.contentType,
                sizeBytes: data.sizeBytes,
                checksum: data.checksum,
                modelVersion: data.modelVersion,
                storageKey: data.storageKey,
                idempotencyKey: data.idempotencyKey,
                uploadUrlExpiresAt: data.uploadUrlExpiresAt,
                createdAt: changedAt,
                updatedAt: changedAt,
              },
              select: { id: true },
            });
            assetId = created.id;
          } else {
            await transaction.scanAsset.update({
              where: { id: existingId },
              data: {
                status: 'PENDING',
                contentType: data.contentType,
                sizeBytes: data.sizeBytes,
                checksum: data.checksum,
                modelVersion: data.modelVersion,
                storageKey: data.storageKey,
                idempotencyKey: data.idempotencyKey,
                uploadUrlExpiresAt: data.uploadUrlExpiresAt,
                revision: { increment: 1 },
                updatedAt: changedAt,
              },
            });
            assetId = existingId;
          }
          await writeAssetUpsert(transaction, assetId, { changedAt });
          await refreshScanRollup(transaction, data.scanId, changedAt);
        }
        return result;
      },
    );
  }

  #isDuplicateAsset(error: unknown): error is Prisma.PrismaClientKnownRequestError {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002' &&
      Array.isArray(error.meta?.target) &&
      error.meta.target.some((field) => ['scanId', 'assetType'].includes(field as string))
    );
  }

  async update(id: string, data: ScanAssetUpdateData): Promise<ScanAssetRecord> {
    const { thumbnailUrl, ...assetData } = data;
    if (this.#idempotency === undefined) {
      const row = await this.#client.scanAsset.update({
        where: { id },
        data: assetData,
        select: legacyScanAssetSelect,
      });
      return toScanAssetRecord(row as ScanAssetRow);
    }
    return await this.#client.$transaction(async (transaction) => {
      const changedAt = new Date();
      const row = await transaction.scanAsset.update({
        where: { id },
        data: { ...assetData, revision: { increment: 1 }, updatedAt: changedAt },
        select: scanAssetSelect,
      });
      if (thumbnailUrl !== undefined) {
        await transaction.scan.update({
          where: { id: row.scanId },
          data: { thumbnail: thumbnailUrl, updatedAt: changedAt },
        });
      }
      await writeAssetUpsert(transaction, id, { changedAt });
      await refreshScanRollup(transaction, row.scanId, changedAt);
      return toScanAssetRecord(row);
    });
  }

  async listByScan(scanId: string): Promise<ScanAssetRecord[]> {
    if (this.#idempotency === undefined) {
      const rows = await this.#client.scanAsset.findMany({
        where: { scanId },
        orderBy: [{ assetType: 'asc' }, { id: 'asc' }],
        select: legacyScanAssetSelect,
      });
      return rows.map((row) => toScanAssetRecord(row as ScanAssetRow));
    }
    const rows = await this.#client.scanAsset.findMany({
      where: { scanId, deletedAt: null },
      orderBy: [{ assetType: 'asc' }, { id: 'asc' }],
      select: scanAssetSelect,
    });
    return rows.map(toScanAssetRecord);
  }
}
