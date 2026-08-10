import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import type {
  ScanAssetCreateData,
  ScanAssetRecord,
  ScanAssetRepository,
  ScanAssetType,
  ScanAssetUpdateData,
} from '../../modules/scan-asset/scan-asset.types.js';

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
    storageKey: row.storageKey,
    idempotencyKey: row.idempotencyKey,
    uploadedAt: row.uploadedAt,
    uploadUrlExpiresAt: row.uploadUrlExpiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaScanAssetRepository implements ScanAssetRepository {
  readonly #client: Pick<PrismaClient, 'scanAsset' | '$transaction'>;

  constructor(client: Pick<PrismaClient, 'scanAsset' | '$transaction'>) {
    this.#client = client;
  }

  async findById(id: string): Promise<ScanAssetRecord | null> {
    const row = await this.#client.scanAsset.findUnique({
      where: { id },
      select: scanAssetSelect,
    });
    return row === null ? null : toScanAssetRecord(row);
  }

  async findByScanAndType(
    scanId: string,
    assetType: ScanAssetType,
  ): Promise<ScanAssetRecord | null> {
    const row = await this.#client.scanAsset.findUnique({
      where: { scanId_assetType: { scanId, assetType } },
      select: scanAssetSelect,
    });
    return row === null ? null : toScanAssetRecord(row);
  }

  async create(data: ScanAssetCreateData): Promise<{ record: ScanAssetRecord; created: boolean }> {
    try {
      const row = await this.#client.scanAsset.create({
        data: {
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
        select: scanAssetSelect,
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

  #isDuplicateAsset(error: unknown): error is Prisma.PrismaClientKnownRequestError {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002' &&
      Array.isArray(error.meta?.target) &&
      error.meta.target.some((field) => ['scanId', 'assetType'].includes(field as string))
    );
  }

  async update(id: string, data: ScanAssetUpdateData): Promise<ScanAssetRecord> {
    const row = await this.#client.scanAsset.update({
      where: { id },
      data,
      select: scanAssetSelect,
    });
    return toScanAssetRecord(row);
  }

  async listByScan(scanId: string): Promise<ScanAssetRecord[]> {
    const rows = await this.#client.scanAsset.findMany({
      where: { scanId },
      orderBy: [{ assetType: 'asc' }, { id: 'asc' }],
      select: scanAssetSelect,
    });
    return rows.map(toScanAssetRecord);
  }
}
