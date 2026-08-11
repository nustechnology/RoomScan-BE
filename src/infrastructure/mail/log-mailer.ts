import type { Logger } from 'pino';

import type { Mailer, MailMessage } from './mailer.types.js';

/**
 * Development-only mailer that writes the message metadata to the application
 * log instead of delivering it. It mirrors the LocalStorageAdapter pattern:
 * `MAIL_PROVIDER=log` is rejected when `NODE_ENV=production`.
 */
export class LogMailer implements Mailer {
  readonly #logger: Logger;

  constructor(logger: Logger) {
    this.#logger = logger;
  }

  sendMail(message: MailMessage): Promise<void> {
    this.#logger.info(
      {
        to: message.to,
        subject: message.subject,
        hasHtml: message.html.length > 0,
      },
      'Invitation email logged by the log mailer',
    );
    return Promise.resolve();
  }
}
