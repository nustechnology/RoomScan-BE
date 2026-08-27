import type { Logger } from 'pino';

import type { ScanAssetRepository } from '../modules/scan-asset/scan-asset.types.js';

export interface UploadSessionExpiryJobDependencies {
  scanAssetRepository: Pick<ScanAssetRepository, 'failStuckUploadSessions'>;
  clock?: () => Date;
  graceSeconds: number;
  logger: Logger;
}

export interface UploadSessionExpiryJobResult {
  failedCount: number;
  durationMs: number;
}

export async function runUploadSessionExpiryJob({
  scanAssetRepository,
  clock,
  graceSeconds,
  logger,
}: UploadSessionExpiryJobDependencies): Promise<UploadSessionExpiryJobResult> {
  const now = (clock ?? (() => new Date()))();
  const cutoff = new Date(now.getTime() - graceSeconds * 1000);
  const startedAt = Date.now();

  logger.info({ cutoff: cutoff.toISOString() }, 'Starting upload-session expiry job');
  const failedCount = await scanAssetRepository.failStuckUploadSessions(cutoff);
  const durationMs = Date.now() - startedAt;

  logger.info({ failedCount, durationMs }, 'Upload-session expiry job completed');
  return { failedCount, durationMs };
}
