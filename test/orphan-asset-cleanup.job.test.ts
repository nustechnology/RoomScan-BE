import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { runOrphanAssetCleanupJob } from '../src/jobs/orphan-asset-cleanup.job.js';
import type { StorageAdapter } from '../src/infrastructure/storage/storage.types.js';
import type {
  ScanAssetRecord,
  ScanAssetRepository,
} from '../src/modules/scan-asset/scan-asset.types.js';

const NOW = new Date('2026-08-05T10:00:00.000Z');

function createLogger() {
  return pino({ enabled: false });
}

function createCandidate(overrides: Partial<ScanAssetRecord> = {}): ScanAssetRecord {
  return {
    id: 'asset-1',
    scanId: 'scan-1',
    assetType: 'MODEL',
    status: 'FAILED',
    contentType: 'model/gltf-binary',
    sizeBytes: 1024,
    checksum: null,
    modelVersion: null,
    storageKey: 'scans/scan-1/model',
    idempotencyKey: null,
    uploadedAt: null,
    uploadUrlExpiresAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('runOrphanAssetCleanupJob', () => {
  it('does nothing when there are no candidates', async () => {
    const listOrphanCandidates = vi
      .fn<ScanAssetRepository['listOrphanCandidates']>()
      .mockResolvedValue([]);
    const deleteOrphanAsset = vi.fn<ScanAssetRepository['deleteOrphanAsset']>();
    const deleteObject = vi.fn<StorageAdapter['deleteObject']>();

    const result = await runOrphanAssetCleanupJob({
      scanAssetRepository: { listOrphanCandidates, deleteOrphanAsset },
      storage: { deleteObject },
      clock: () => NOW,
      graceSeconds: 300,
      batchSize: 200,
      logger: createLogger(),
    });

    expect(deleteObject).not.toHaveBeenCalled();
    expect(deleteOrphanAsset).not.toHaveBeenCalled();
    expect(result).toEqual({
      candidateCount: 0,
      deletedCount: 0,
      storageDeleteFailureCount: 0,
      durationMs: expect.any(Number) as number,
    });
  });

  it('deletes each candidate row after best-effort deleting its storage object', async () => {
    const candidates = [createCandidate({ id: 'asset-1' }), createCandidate({ id: 'asset-2' })];
    const listOrphanCandidates = vi
      .fn<ScanAssetRepository['listOrphanCandidates']>()
      .mockResolvedValue(candidates);
    const deleteOrphanAsset = vi
      .fn<ScanAssetRepository['deleteOrphanAsset']>()
      .mockResolvedValue(true);
    const deleteObject = vi.fn<StorageAdapter['deleteObject']>().mockResolvedValue(undefined);

    const result = await runOrphanAssetCleanupJob({
      scanAssetRepository: { listOrphanCandidates, deleteOrphanAsset },
      storage: { deleteObject },
      clock: () => NOW,
      graceSeconds: 300,
      batchSize: 200,
      logger: createLogger(),
    });

    expect(deleteObject).toHaveBeenCalledTimes(2);
    expect(deleteOrphanAsset).toHaveBeenCalledWith('asset-1', {
      status: 'FAILED',
      uploadUrlExpiresAt: null,
    });
    expect(result).toEqual({
      candidateCount: 2,
      deletedCount: 2,
      storageDeleteFailureCount: 0,
      durationMs: expect.any(Number) as number,
    });
  });

  it('continues and still deletes the row when a storage delete fails on one candidate', async () => {
    const candidates = [createCandidate({ id: 'asset-1' }), createCandidate({ id: 'asset-2' })];
    const listOrphanCandidates = vi
      .fn<ScanAssetRepository['listOrphanCandidates']>()
      .mockResolvedValue(candidates);
    const deleteOrphanAsset = vi
      .fn<ScanAssetRepository['deleteOrphanAsset']>()
      .mockResolvedValue(true);
    const deleteObject = vi
      .fn<StorageAdapter['deleteObject']>()
      .mockRejectedValueOnce(new Error('storage down'))
      .mockResolvedValueOnce(undefined);
    const logger = createLogger();
    const logWarn = vi.spyOn(logger, 'warn');

    const result = await runOrphanAssetCleanupJob({
      scanAssetRepository: { listOrphanCandidates, deleteOrphanAsset },
      storage: { deleteObject },
      clock: () => NOW,
      graceSeconds: 300,
      batchSize: 200,
      logger,
    });

    expect(deleteOrphanAsset).toHaveBeenCalledTimes(2);
    expect(result.deletedCount).toBe(2);
    expect(result.storageDeleteFailureCount).toBe(1);
    expect(logWarn).toHaveBeenCalledOnce();
    const [loggedContext] = logWarn.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(JSON.stringify(loggedContext)).not.toContain('scans/scan-1/model');
  });

  it('does not count a row as deleted when a concurrent write already moved it', async () => {
    const listOrphanCandidates = vi
      .fn<ScanAssetRepository['listOrphanCandidates']>()
      .mockResolvedValue([createCandidate()]);
    const deleteOrphanAsset = vi
      .fn<ScanAssetRepository['deleteOrphanAsset']>()
      .mockResolvedValue(false);
    const deleteObject = vi.fn<StorageAdapter['deleteObject']>().mockResolvedValue(undefined);

    const result = await runOrphanAssetCleanupJob({
      scanAssetRepository: { listOrphanCandidates, deleteOrphanAsset },
      storage: { deleteObject },
      clock: () => NOW,
      graceSeconds: 300,
      batchSize: 200,
      logger: createLogger(),
    });

    expect(result.deletedCount).toBe(0);
    expect(result.candidateCount).toBe(1);
  });

  it('is idempotent: re-running after a successful pass finds nothing left to clean up', async () => {
    const listOrphanCandidates = vi
      .fn<ScanAssetRepository['listOrphanCandidates']>()
      .mockResolvedValueOnce([createCandidate()])
      .mockResolvedValueOnce([]);
    const deleteOrphanAsset = vi
      .fn<ScanAssetRepository['deleteOrphanAsset']>()
      .mockResolvedValue(true);
    const deleteObject = vi.fn<StorageAdapter['deleteObject']>().mockResolvedValue(undefined);
    const deps = {
      scanAssetRepository: { listOrphanCandidates, deleteOrphanAsset },
      storage: { deleteObject },
      clock: () => NOW,
      graceSeconds: 300,
      batchSize: 200,
      logger: createLogger(),
    };

    const first = await runOrphanAssetCleanupJob(deps);
    const second = await runOrphanAssetCleanupJob(deps);

    expect(first.deletedCount).toBe(1);
    expect(second).toEqual({
      candidateCount: 0,
      deletedCount: 0,
      storageDeleteFailureCount: 0,
      durationMs: expect.any(Number) as number,
    });
  });
});
