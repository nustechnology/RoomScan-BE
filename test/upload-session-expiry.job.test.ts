import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { runUploadSessionExpiryJob } from '../src/jobs/upload-session-expiry.job.js';
import type { ScanAssetRepository } from '../src/modules/scan-asset/scan-asset.types.js';

function createLogger() {
  return pino({ enabled: false });
}

describe('runUploadSessionExpiryJob', () => {
  it('applies the configured grace period to the cutoff passed to the repository', async () => {
    const failStuckUploadSessions = vi
      .fn<ScanAssetRepository['failStuckUploadSessions']>()
      .mockResolvedValue(2);
    const now = new Date('2026-08-05T10:00:00.000Z');

    const result = await runUploadSessionExpiryJob({
      scanAssetRepository: { failStuckUploadSessions },
      clock: () => now,
      graceSeconds: 300,
      logger: createLogger(),
    });

    expect(failStuckUploadSessions).toHaveBeenCalledWith(new Date('2026-08-05T09:55:00.000Z'));
    expect(result.failedCount).toBe(2);
  });

  it('is idempotent: a re-run with nothing stuck reports zero', async () => {
    const failStuckUploadSessions = vi
      .fn<ScanAssetRepository['failStuckUploadSessions']>()
      .mockResolvedValue(0);

    const result = await runUploadSessionExpiryJob({
      scanAssetRepository: { failStuckUploadSessions },
      graceSeconds: 300,
      logger: createLogger(),
    });

    expect(result.failedCount).toBe(0);
  });

  it('propagates a repository failure so the CLI can exit non-zero', async () => {
    const failStuckUploadSessions = vi
      .fn<ScanAssetRepository['failStuckUploadSessions']>()
      .mockRejectedValue(new Error('db unavailable'));

    await expect(
      runUploadSessionExpiryJob({
        scanAssetRepository: { failStuckUploadSessions },
        graceSeconds: 300,
        logger: createLogger(),
      }),
    ).rejects.toThrow('db unavailable');
  });
});
