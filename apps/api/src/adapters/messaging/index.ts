import nodemailer, { type Transporter } from 'nodemailer';
import type { ContactChannel } from '@prisma/client';
import { config } from '../../config';
import { prisma } from '../../lib/db';

/**
 * Messaging adapters. Email goes through SMTP when SMTP_URL is set (Mailpit in Docker);
 * SMS and WhatsApp are sandbox-only until provider credentials are added (KNOWN_GAPS.md).
 * Every message is also written to Outbox so admins can see what was sent in sandbox mode.
 */
export interface Message {
  tenantId: string | null;
  to: string;
  subject?: string;
  text: string;
  html?: string;
}

export interface MessagingAdapter {
  readonly channel: ContactChannel;
  readonly sandbox: boolean;
  send(msg: Message): Promise<void>;
}

let transporter: Transporter | null = null;
const getTransporter = () => (transporter ??= config.SMTP_URL ? nodemailer.createTransport(config.SMTP_URL) : null);

async function record(channel: ContactChannel, msg: Message, error?: string) {
  await prisma.outbox.create({
    data: { tenantId: msg.tenantId, channel, to: msg.to, subject: msg.subject ?? null, body: msg.text, status: error ? 'FAILED' : 'SENT', error: error ?? null },
  });
}

const email: MessagingAdapter = {
  channel: 'EMAIL',
  get sandbox() {
    return !config.SMTP_URL;
  },
  async send(msg) {
    const t = getTransporter();
    if (!t) return record('EMAIL', msg);
    try {
      await t.sendMail({ from: config.MAIL_FROM, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html });
      await record('EMAIL', msg);
    } catch (e) {
      await record('EMAIL', msg, (e as Error).message.slice(0, 500));
    }
  },
};

const sandboxChannel = (channel: ContactChannel): MessagingAdapter => ({
  channel,
  sandbox: true,
  send: (msg) => record(channel, msg),
});

const adapters: Record<ContactChannel, MessagingAdapter> = {
  EMAIL: email,
  SMS: sandboxChannel('SMS'),
  WHATSAPP: sandboxChannel('WHATSAPP'),
};

export const messaging = (channel: ContactChannel) => adapters[channel];
