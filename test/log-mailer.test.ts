import type { Logger } from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { LogMailer } from '../src/infrastructure/mail/log-mailer.js';

describe('LogMailer', () => {
  it('writes the message metadata to the application log', async () => {
    const info = vi.fn();
    const logger = { info } as unknown as Logger;
    const mailer = new LogMailer(logger);

    await mailer.sendMail({
      to: 'recipient@example.com',
      subject: 'RoomScan invited you to a Project',
      html: '<p>Hi</p>',
    });

    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'recipient@example.com' }),
      expect.any(String),
    );
    const message = info.mock.calls[0]?.[0] as { subject?: string } | undefined;
    expect(message?.subject).toBe('RoomScan invited you to a Project');
  });
});
