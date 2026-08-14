export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface Mailer {
  sendMail(message: MailMessage): Promise<void>;
}

export interface MailTransport {
  sendMail(options: {
    from: string;
    to: string;
    subject: string;
    html: string;
    text?: string;
  }): Promise<unknown>;
}
