import type { Logger } from 'pino';

import type { StorageAdapter } from '../infrastructure/storage/storage.types.js';
import type { ScanAssetRepository } from '../modules/scan-asset/scan-asset.types.js';

export interface OrphanAssetCleanupJobDependencies {
  scanAssetRepository: Pick<ScanAssetRepository, 'listOrphanCandidates' | 'deleteOrphanAsset'>;
  storage: Pick<StorageAdapter, 'deleteObject'>;
  clock?: () => Date;
  graceSeconds: number;
  batchSize: number;
  logger: Logger;
}

export interface OrphanAssetCleanupJobResult {
  candidateCount: number;
  deletedCount: number;
  storageDeleteFailureCount: number;
  durationMs: number;
}

export async function runOrphanAssetCleanupJob({
  scanAssetRepository,
  storage,
  clock,
  graceSeconds,
  batchSize,
  logger,
}: OrphanAssetCleanupJobDependencies): Promise<OrphanAssetCleanupJobResult> {
  const now = (clock ?? (() => new Date()))();
  const cutoff = new Date(now.getTime() - graceSeconds * 1000);
  const startedAt = Date.now();

  logger.info({ cutoff: cutoff.toISOString(), batchSize }, 'Starting orphan-asset cleanup job');
  const candidates = await scanAssetRepository.listOrphanCandidates(cutoff, batchSize);

  let deletedCount = 0;
  let storageDeleteFailureCount = 0;

  for (const candidate of candidates) {
    let storageDeleted = true;
    try {
      await storage.deleteObject(candidate.storageKey);
    } catch (error) {
      storageDeleted = false;
      storageDeleteFailureCount += 1;
      logger.warn(
        { err: error, assetId: candidate.id },
        'Failed to delete an orphan asset object from storage; the row is preserved for retry on the next run',
      );
    }

    if (!storageDeleted) {
      continue;
    }

    const deleted = await scanAssetRepository.deleteOrphanAsset(candidate.id, {
      status: candidate.status,
      uploadUrlExpiresAt: candidate.uploadUrlExpiresAt,
    });
    if (deleted) {
      deletedCount += 1;
    }
  }

  const durationMs = Date.now() - startedAt;
  const result = {
    candidateCount: candidates.length,
    deletedCount,
    storageDeleteFailureCount,
    durationMs,
  };
  logger.info(result, 'Orphan-asset cleanup job completed');
  return result;
}
