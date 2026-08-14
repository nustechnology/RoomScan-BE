import nodemailer from 'nodemailer';

import type { Mailer, MailMessage, MailTransport } from './mailer.types.js';

export interface SmtpTransportOptions {
  host: string;
  port: number;
  user: string;
  pass: string;
  secure: boolean;
}

export function createNodemailerTransport(
  options: SmtpTransportOptions,
): Pick<ReturnType<typeof nodemailer.createTransport>, 'sendMail'> {
  return nodemailer.createTransport({
    host: options.host,
    port: options.port,
    secure: options.secure,
    auth: {
      user: options.user,
      pass: options.pass,
    },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
  });
}

export interface SmtpMailerOptions {
  from: string;
  transport: MailTransport;
}

export class SmtpMailer implements Mailer {
  readonly #from: string;
  readonly #transport: MailTransport;

  constructor({ from, transport }: SmtpMailerOptions) {
    this.#from = from;
    this.#transport = transport;
  }

  async sendMail(message: MailMessage): Promise<void> {
    await this.#transport.sendMail({
      from: this.#from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      ...(message.text === undefined ? {} : { text: message.text }),
    });
  }
}
