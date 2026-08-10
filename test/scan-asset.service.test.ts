import { describe, expect, it, vi } from 'vitest';

import type { StorageAdapter } from '../src/infrastructure/storage/storage.types.js';
import { ProjectPermissionService } from '../src/modules/project/project.permissions.js';
import { ScanNotFoundError } from '../src/modules/scan/scan.errors.js';
import type { ScanRepository } from '../src/modules/scan/scan.types.js';
import {
  AssetNotReadyError,
  AssetUploadFailedError,
  InvalidAssetRequestError,
  ScanAssetNotFoundError,
  StorageUnavailableError,
  UploadSessionExpiredError,
} from '../src/modules/scan-asset/scan-asset.errors.js';
import { ScanAssetService } from '../src/modules/scan-asset/scan-asset.service.js';
import type {
  ScanAssetRecord,
  ScanAssetRepository,
} from '../src/modules/scan-asset/scan-asset.types.js';
import type { ProjectRepository } from '../src/modules/project/project.types.js';

const OWNER_ID = 'eb5d278f-c857-45c7-887d-7be65288cb75';
const VIEWER_ID = '8c53d31d-2788-48de-82a0-c4f219ca3701';
const PROJECT_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const SCAN_ID = 'f1e2d3c4-a5b6-7890-abcd-ef1234567890';
const ASSET_ID = 'c0ffee00-0000-4000-8000-000000000001';
const NOW = new Date('2026-07-29T10:00:00.000Z');

function createAssetRecord(overrides: Partial<ScanAssetRecord> = {}): ScanAssetRecord {
  return {
    id: ASSET_ID,
    scanId: SCAN_ID,
    assetType: 'MODEL',
    status: 'PENDING',
    contentType: 'model/gltf-binary',
    sizeBytes: 1024,
    checksum: 'abc-checksum',
    modelVersion: '1',
    storageKey: `scans/${SCAN_ID}/model`,
    idempotencyKey: null,
    uploadedAt: null,
    uploadUrlExpiresAt: new Date(NOW.getTime() + 60_000),
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function createHarness() {
  const findProjectId = vi.fn<ScanRepository['findProjectId']>().mockResolvedValue(PROJECT_ID);
  const updateAssetStatus = vi
    .fn<ScanRepository['updateAssetStatus']>()
    .mockResolvedValue(undefined);
  const scanRepository = {
    findProjectId,
    updateAssetStatus,
  } as unknown as ScanRepository;

  const findById = vi.fn<ScanAssetRepository['findById']>().mockResolvedValue(createAssetRecord());
  const findByScanAndType = vi
    .fn<ScanAssetRepository['findByScanAndType']>()
    .mockResolvedValue(null);
  const create = vi
    .fn<ScanAssetRepository['create']>()
    .mockResolvedValue({ record: createAssetRecord(), created: true });
  const update = vi.fn<ScanAssetRepository['update']>().mockResolvedValue(createAssetRecord());
  const listByScan = vi.fn<ScanAssetRepository['listByScan']>().mockResolvedValue([]);
  const assetRepository: ScanAssetRepository = {
    findById,
    findByScanAndType,
    create,
    update,
    listByScan,
  };

  const findAccessRole = vi
    .fn<ProjectRepository['findAccessRole']>()
    .mockImplementation(async (_projectId, userId) =>
      Promise.resolve(userId === OWNER_ID ? 'OWNER' : userId === VIEWER_ID ? 'VIEWER' : null),
    );
  const permissions = new ProjectPermissionService({
    findAccessRole,
  } as unknown as ProjectRepository);

  const buildObjectKey = vi
    .fn<StorageAdapter['buildObjectKey']>()
    .mockReturnValue(`scans/${SCAN_ID}/model`);
  const createUploadUrl = vi
    .fn<StorageAdapter['createUploadUrl']>()
    .mockResolvedValue({ url: 'http://storage/upload', expiresAt: NOW });
  const createDownloadUrl = vi
    .fn<StorageAdapter['createDownloadUrl']>()
    .mockResolvedValue({ url: 'http://storage/download', expiresAt: NOW });
  const verifyObject = vi.fn<StorageAdapter['verifyObject']>().mockResolvedValue(true);
  const storage: StorageAdapter = {
    provider: 'local',
    buildObjectKey,
    createUploadUrl,
    createDownloadUrl,
    verifyObject,
  };

  const service = new ScanAssetService({
    repository: assetRepository,
    scanRepository,
    permissions,
    storage,
    clock: () => NOW,
    uploadUrlTtlSeconds: 900,
    downloadUrlTtlSeconds: 60,
    maxModelSizeBytes: 500_000_000,
    maxThumbnailSizeBytes: 10_000_000,
  });

  return {
    findProjectId,
    updateAssetStatus,
    findById,
    findByScanAndType,
    create,
    update,
    listByScan,
    findAccessRole,
    createUploadUrl,
    createDownloadUrl,
    verifyObject,
    service,
  };
}

describe('ScanAssetService', () => {
  it('creates an upload session as the Owner', async () => {
    const { service, createUploadUrl } = createHarness();

    const result = await service.createUploadSession(OWNER_ID, SCAN_ID, {
      assetType: 'MODEL',
      contentType: 'model/gltf-binary',
      sizeBytes: 1024,
      checksum: 'abc',
      modelVersion: '1',
    });

    expect(result.created).toBe(true);
    expect(result.assetId).toBe(ASSET_ID);
    expect(createUploadUrl).toHaveBeenCalled();
  });

  it('returns an active session unchanged when it already exists', async () => {
    const { service, findByScanAndType, create } = createHarness();
    findByScanAndType.mockResolvedValueOnce(createAssetRecord());

    const result = await service.createUploadSession(OWNER_ID, SCAN_ID, {
      assetType: 'MODEL',
      contentType: 'model/gltf-binary',
      sizeBytes: 1024,
      checksum: 'abc',
      modelVersion: '1',
    });

    expect(result.created).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it('refreshes an expired session without reporting a new creation', async () => {
    const { service, findByScanAndType, update } = createHarness();
    findByScanAndType.mockResolvedValueOnce(
      createAssetRecord({ uploadUrlExpiresAt: new Date(NOW.getTime() - 60_000) }),
    );
    update.mockResolvedValueOnce(createAssetRecord());

    const result = await service.createUploadSession(OWNER_ID, SCAN_ID, {
      assetType: 'MODEL',
      contentType: 'model/gltf-binary',
      sizeBytes: 1024,
      checksum: 'abc',
      modelVersion: '1',
    });

    expect(result.created).toBe(false);
    expect(result.uploadSessionId).toBe(ASSET_ID);
  });

  it('resolves concurrent creates to the same upload session', async () => {
    const { service, findByScanAndType, create } = createHarness();
    findByScanAndType.mockResolvedValue(null);
    const record = createAssetRecord();
    create.mockResolvedValueOnce({ record, created: true });
    create.mockResolvedValue({ record, created: false });

    const payload = {
      assetType: 'MODEL' as const,
      contentType: 'model/gltf-binary',
      sizeBytes: 1024,
      checksum: 'abc',
      modelVersion: '1',
    };
    const [first, second] = await Promise.all([
      service.createUploadSession(OWNER_ID, SCAN_ID, payload),
      service.createUploadSession(OWNER_ID, SCAN_ID, payload),
    ]);

    expect(first.uploadSessionId).toBe(record.id);
    expect(first.created).toBe(true);
    expect(second.uploadSessionId).toBe(record.id);
    expect(second.created).toBe(false);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('rejects a Viewer from creating an upload session', async () => {
    const { service } = createHarness();

    await expect(
      service.createUploadSession(VIEWER_ID, SCAN_ID, {
        assetType: 'MODEL',
        contentType: 'model/gltf-binary',
        sizeBytes: 1024,
        checksum: 'abc',
        modelVersion: '1',
      }),
    ).rejects.toBeInstanceOf(ScanNotFoundError);
  });

  it('rejects a disallowed content type', async () => {
    const { service } = createHarness();

    await expect(
      service.createUploadSession(OWNER_ID, SCAN_ID, {
        assetType: 'MODEL',
        contentType: 'text/plain',
        sizeBytes: 1024,
      }),
    ).rejects.toBeInstanceOf(InvalidAssetRequestError);
  });

  it('reports a storage outage when minting an upload URL', async () => {
    const { service, createUploadUrl } = createHarness();
    createUploadUrl.mockRejectedValueOnce(new Error('down'));

    await expect(
      service.createUploadSession(OWNER_ID, SCAN_ID, {
        assetType: 'MODEL',
        contentType: 'model/gltf-binary',
        sizeBytes: 1024,
        checksum: 'abc',
        modelVersion: '1',
      }),
    ).rejects.toBeInstanceOf(StorageUnavailableError);
  });

  it('rejects an oversized model asset', async () => {
    const { service } = createHarness();

    await expect(
      service.createUploadSession(OWNER_ID, SCAN_ID, {
        assetType: 'MODEL',
        contentType: 'model/gltf-binary',
        sizeBytes: 600_000_000,
      }),
    ).rejects.toBeInstanceOf(InvalidAssetRequestError);
  });

  it('completes an upload and marks the model synced', async () => {
    const { service, update, updateAssetStatus } = createHarness();
    update.mockResolvedValueOnce(createAssetRecord({ status: 'UPLOADED', uploadedAt: NOW }));

    const result = await service.completeUpload(OWNER_ID, ASSET_ID, {});

    expect(result.status).toBe('UPLOADED');
    expect(updateAssetStatus).toHaveBeenCalledWith(SCAN_ID, {
      assetStatus: 'UPLOADED',
      syncStatus: 'SYNCED',
    });
  });

  it('rejects a client-supplied size exceeding the model limit', async () => {
    const { service } = createHarness();

    await expect(
      service.completeUpload(OWNER_ID, ASSET_ID, { sizeBytes: 600_000_000 }),
    ).rejects.toBeInstanceOf(InvalidAssetRequestError);
  });

  it('is idempotent when the upload is already completed', async () => {
    const { service, findById, update, updateAssetStatus } = createHarness();
    findById.mockResolvedValueOnce(createAssetRecord({ status: 'UPLOADED', uploadedAt: NOW }));

    const result = await service.completeUpload(OWNER_ID, ASSET_ID, {});

    expect(result.status).toBe('UPLOADED');
    expect(update).not.toHaveBeenCalled();
    expect(updateAssetStatus).toHaveBeenCalledWith(SCAN_ID, {
      assetStatus: 'UPLOADED',
      syncStatus: 'SYNCED',
    });
  });

  it('rejects completing an expired upload session', async () => {
    const { service, findById } = createHarness();
    findById.mockResolvedValueOnce(
      createAssetRecord({ uploadUrlExpiresAt: new Date(NOW.getTime() - 60_000) }),
    );

    await expect(service.completeUpload(OWNER_ID, ASSET_ID, {})).rejects.toBeInstanceOf(
      UploadSessionExpiredError,
    );
  });

  it('marks the asset failed when the store cannot verify the object', async () => {
    const { service, update, verifyObject } = createHarness();
    verifyObject.mockResolvedValueOnce(false);

    await expect(service.completeUpload(OWNER_ID, ASSET_ID, {})).rejects.toBeInstanceOf(
      AssetUploadFailedError,
    );
    expect(update).toHaveBeenCalledWith(ASSET_ID, { status: 'FAILED' });
  });

  it('reports a storage outage as unavailable', async () => {
    const { service, verifyObject } = createHarness();
    verifyObject.mockRejectedValueOnce(new Error('down'));

    await expect(service.completeUpload(OWNER_ID, ASSET_ID, {})).rejects.toBeInstanceOf(
      StorageUnavailableError,
    );
  });

  it('lists assets for a Viewer', async () => {
    const { service, listByScan } = createHarness();
    listByScan.mockResolvedValueOnce([createAssetRecord()]);

    const result = await service.listAssets(VIEWER_ID, SCAN_ID);

    expect(result.items).toHaveLength(1);
  });

  it('returns a download URL for an uploaded asset', async () => {
    const { service, findByScanAndType, createDownloadUrl } = createHarness();
    findByScanAndType.mockResolvedValueOnce(
      createAssetRecord({ status: 'UPLOADED', uploadedAt: NOW }),
    );

    const result = await service.getDownloadUrl(VIEWER_ID, SCAN_ID, 'MODEL');

    expect(result.downloadUrl).toBe('http://storage/download');
    expect(createDownloadUrl).toHaveBeenCalled();
  });

  it('throws not-found when the asset does not exist', async () => {
    const { service, findByScanAndType } = createHarness();
    findByScanAndType.mockResolvedValueOnce(null);

    await expect(service.getDownloadUrl(VIEWER_ID, SCAN_ID, 'MODEL')).rejects.toBeInstanceOf(
      ScanAssetNotFoundError,
    );
  });

  it('reports a storage outage when minting a download URL', async () => {
    const { service, findByScanAndType, createDownloadUrl } = createHarness();
    findByScanAndType.mockResolvedValueOnce(
      createAssetRecord({ status: 'UPLOADED', uploadedAt: NOW }),
    );
    createDownloadUrl.mockRejectedValueOnce(new Error('down'));

    await expect(service.getDownloadUrl(VIEWER_ID, SCAN_ID, 'MODEL')).rejects.toBeInstanceOf(
      StorageUnavailableError,
    );
  });

  it('returns asset-not-ready when the asset has not been uploaded', async () => {
    const { service, findByScanAndType } = createHarness();
    findByScanAndType.mockResolvedValueOnce(createAssetRecord());

    await expect(service.getDownloadUrl(VIEWER_ID, SCAN_ID, 'MODEL')).rejects.toBeInstanceOf(
      AssetNotReadyError,
    );
  });

  it('blocks a download URL for a scan with no project access', async () => {
    const { service, findProjectId } = createHarness();
    findProjectId.mockResolvedValueOnce(null);

    await expect(service.getDownloadUrl(VIEWER_ID, SCAN_ID, 'MODEL')).rejects.toBeInstanceOf(
      ScanNotFoundError,
    );
  });

  it('marks an upload failed as the Owner and reflects it on the scan', async () => {
    const { service, updateAssetStatus, update } = createHarness();
    update.mockResolvedValueOnce(createAssetRecord({ status: 'FAILED' }));

    const result = await service.failUpload(OWNER_ID, ASSET_ID, { reason: 'timeout' });

    expect(result.status).toBe('FAILED');
    expect(updateAssetStatus).toHaveBeenCalledWith(SCAN_ID, {
      assetStatus: 'FAILED',
      syncStatus: 'FAILED',
    });
  });

  it('throws not-found for a missing upload session', async () => {
    const { service, findById } = createHarness();
    findById.mockResolvedValueOnce(null);

    await expect(service.failUpload(OWNER_ID, ASSET_ID, {})).rejects.toBeInstanceOf(
      ScanAssetNotFoundError,
    );
  });
});
