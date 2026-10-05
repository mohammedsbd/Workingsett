import { Injectable } from '@nestjs/common';
import fs from 'node:fs/promises';
import Handlebars from 'handlebars';
import type { SendMailOptions } from 'nodemailer';

export type CapturedMail = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

/**
 * Drop-in replacement for MailerService in tests. It renders the template the
 * same way (so template errors still fail the test) but keeps every message in
 * memory instead of sending it over SMTP.
 */
@Injectable()
export class InMemoryMailer {
  readonly messages: CapturedMail[] = [];

  async sendMail({
    templatePath,
    context,
    ...mailOptions
  }: SendMailOptions & {
    templatePath: string;
    context: Record<string, unknown>;
  }): Promise<void> {
    let html: string | undefined;
    if (templatePath) {
      const template = await fs.readFile(templatePath, 'utf-8');
      html = Handlebars.compile(template, { strict: true })(context);
    }

    this.messages.push({
      to: String(mailOptions.to ?? ''),
      subject: String(mailOptions.subject ?? ''),
      text: String(mailOptions.text ?? ''),
      html,
    });
  }

  clear(): void {
    this.messages.length = 0;
  }

  /**
   * Returns the `hash` query parameter of the most recent link sent to `to`
   * whose path contains `pathFragment` (for example `confirm-email`).
   */
  findHash(to: string, pathFragment: string): string {
    const recipient = to.toLowerCase();
    for (const message of [...this.messages].reverse()) {
      if (message.to.toLowerCase() !== recipient) continue;
      const link = message.text
        .split(/\s+/)
        .find((word) => word.startsWith('http') && word.includes(pathFragment));
      const hash = link ? new URL(link).searchParams.get('hash') : null;
      if (hash) return hash;
    }
    throw new Error(`No "${pathFragment}" mail with a hash was sent to ${to}`);
  }
}
