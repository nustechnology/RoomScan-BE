import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { runInvitationExpiryJob } from '../src/jobs/invitation-expiry.job.js';
import type { ShareRepository } from '../src/modules/share/share.types.js';

function createLogger() {
  return pino({ enabled: false });
}

describe('runInvitationExpiryJob', () => {
  it('expires pending invitations and reports the count', async () => {
    const expirePendingInvitations = vi
      .fn<ShareRepository['expirePendingInvitations']>()
      .mockResolvedValue(3);
    const now = new Date('2026-08-05T10:00:00.000Z');

    const result = await runInvitationExpiryJob({
      shareRepository: { expirePendingInvitations },
      clock: () => now,
      logger: createLogger(),
    });

    expect(expirePendingInvitations).toHaveBeenCalledWith(now);
    expect(result.expiredCount).toBe(3);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('is idempotent: a re-run with nothing left to expire reports zero', async () => {
    const expirePendingInvitations = vi
      .fn<ShareRepository['expirePendingInvitations']>()
      .mockResolvedValue(0);

    const result = await runInvitationExpiryJob({
      shareRepository: { expirePendingInvitations },
      logger: createLogger(),
    });

    expect(result.expiredCount).toBe(0);
  });

  it('propagates a repository failure so the CLI can exit non-zero', async () => {
    const expirePendingInvitations = vi
      .fn<ShareRepository['expirePendingInvitations']>()
      .mockRejectedValue(new Error('db unavailable'));

    await expect(
      runInvitationExpiryJob({
        shareRepository: { expirePendingInvitations },
        logger: createLogger(),
      }),
    ).rejects.toThrow('db unavailable');
  });
});
