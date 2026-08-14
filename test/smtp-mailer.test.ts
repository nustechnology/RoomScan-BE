import { describe, expect, it, vi } from 'vitest';

import type { MailTransport } from '../src/infrastructure/mail/mailer.types.js';
import { SmtpMailer, createNodemailerTransport } from '../src/infrastructure/mail/smtp-mailer.js';

const FROM = 'RoomScan App <notifications@roomscan.app>';

const { createTransport } = vi.hoisted(() => ({ createTransport: vi.fn() }));

vi.mock('nodemailer', () => ({
  default: { createTransport },
}));

describe('SmtpMailer', () => {
  it('forwards the message with the configured from address', async () => {
    const sendMail = vi.fn().mockResolvedValue({});
    const transport: MailTransport = { sendMail };
    const mailer = new SmtpMailer({ from: FROM, transport });

    await mailer.sendMail({
      to: 'recipient@example.com',
      subject: 'A subject',
      html: '<p>Hi</p>',
      text: 'Hi',
    });

    expect(sendMail).toHaveBeenCalledWith({
      from: FROM,
      to: 'recipient@example.com',
      subject: 'A subject',
      html: '<p>Hi</p>',
      text: 'Hi',
    });
  });

  it('omits the text body when it is absent', async () => {
    const sendMail = vi.fn<MailTransport['sendMail']>().mockResolvedValue({});
    const mailer = new SmtpMailer({ from: FROM, transport: { sendMail } });

    await mailer.sendMail({
      to: 'recipient@example.com',
      subject: 'A subject',
      html: '<p>Hi</p>',
    });

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: FROM,
        to: 'recipient@example.com',
        subject: 'A subject',
        html: '<p>Hi</p>',
      }),
    );
    const options = sendMail.mock.calls[0]?.[0];
    expect(options).not.toHaveProperty('text');
  });

  it('propagates transport failures', async () => {
    const mailer = new SmtpMailer({
      from: FROM,
      transport: { sendMail: vi.fn().mockRejectedValue(new Error('smtp unavailable')) },
    });

    await expect(
      mailer.sendMail({ to: 'recipient@example.com', subject: 'A subject', html: '<p>Hi</p>' }),
    ).rejects.toThrow('smtp unavailable');
  });
});

describe('createNodemailerTransport', () => {
  it('builds a transporter with a sendMail function', () => {
    const sendMail = vi.fn();
    createTransport.mockReturnValue({ sendMail });

    const transport = createNodemailerTransport({
      host: 'sandbox.smtp.mailtrap.io',
      port: 2525,
      user: 'mailtrap-user',
      pass: 'mailtrap-pass',
      secure: false,
    });

    expect(transport.sendMail).toBe(sendMail);
  });

  it('sets explicit connection timeouts so a hung SMTP server cannot stall a request', () => {
    createTransport.mockReturnValue({ sendMail: vi.fn() });

    createNodemailerTransport({
      host: 'sandbox.smtp.mailtrap.io',
      port: 2525,
      user: 'mailtrap-user',
      pass: 'mailtrap-pass',
      secure: false,
    });

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'sandbox.smtp.mailtrap.io',
        port: 2525,
        secure: false,
        auth: { user: 'mailtrap-user', pass: 'mailtrap-pass' },
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 10_000,
      }),
    );
  });
});
