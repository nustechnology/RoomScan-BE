import type { Logger } from 'pino';

import type { ShareRepository } from '../modules/share/share.types.js';

export interface InvitationExpiryJobDependencies {
  shareRepository: Pick<ShareRepository, 'expirePendingInvitations'>;
  clock?: () => Date;
  logger: Logger;
}

export interface InvitationExpiryJobResult {
  expiredCount: number;
  durationMs: number;
}

export async function runInvitationExpiryJob({
  shareRepository,
  clock,
  logger,
}: InvitationExpiryJobDependencies): Promise<InvitationExpiryJobResult> {
  const now = (clock ?? (() => new Date()))();
  const startedAt = Date.now();

  logger.info('Starting invitation expiry job');
  const expiredCount = await shareRepository.expirePendingInvitations(now);
  const durationMs = Date.now() - startedAt;

  logger.info({ expiredCount, durationMs }, 'Invitation expiry job completed');
  return { expiredCount, durationMs };
}
