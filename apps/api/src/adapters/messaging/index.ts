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
  /** Carries a secret (one-time code): the Outbox keeps a redacted body unless the outbox itself is the delivery channel. */
  sensitive?: boolean;
}

export interface MessagingAdapter {
  readonly channel: ContactChannel;
  readonly sandbox: boolean;
  send(msg: Message): Promise<void>;
}

let transporter: { url: string; t: Transporter } | null = null;
const getTransporter = (): Transporter | null => {
  if (!config.SMTP_URL) return null;
  if (transporter?.url !== config.SMTP_URL) transporter = { url: config.SMTP_URL, t: nodemailer.createTransport(config.SMTP_URL) };
  return transporter.t;
};

export const REDACTED_BODY = '[скрыто: одноразовый код]';

/**
 * Body stored in the Outbox (readable by ADMIN via GET /org/outbox).
 * Sensitive messages (OTP codes) are redacted once a real provider delivers them. In sandbox mode (no provider for the
 * channel — SMS/WhatsApp today, email without SMTP_URL) the Outbox IS the delivery channel for demos and tests, so the
 * code is kept only when DEMO_MODE is on or NODE_ENV is not production; a production sandbox stores it redacted
 * (such codes are then undeliverable — see KNOWN_GAPS.md, SMS/WhatsApp providers).
 */
export function outboxBody(msg: Message, sandbox: boolean): string {
  if (!msg.sensitive) return msg.text;
  if (sandbox && (config.DEMO_MODE || config.NODE_ENV !== 'production')) return msg.text;
  return REDACTED_BODY;
}

async function record(channel: ContactChannel, msg: Message, sandbox: boolean, error?: string) {
  await prisma.outbox.create({
    data: { tenantId: msg.tenantId, channel, to: msg.to, subject: msg.subject ?? null, body: outboxBody(msg, sandbox), status: error ? 'FAILED' : 'SENT', error: error ?? null },
  });
}

const email: MessagingAdapter = {
  channel: 'EMAIL',
  get sandbox() {
    return !config.SMTP_URL;
  },
  async send(msg) {
    const t = getTransporter();
    if (!t) return record('EMAIL', msg, true);
    try {
      await t.sendMail({ from: config.MAIL_FROM, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html });
      await record('EMAIL', msg, false);
    } catch (e) {
      await record('EMAIL', msg, false, (e as Error).message.slice(0, 500));
    }
  },
};

const sandboxChannel = (channel: ContactChannel): MessagingAdapter => ({
  channel,
  sandbox: true,
  send: (msg) => record(channel, msg, true),
});

const adapters: Record<ContactChannel, MessagingAdapter> = {
  EMAIL: email,
  SMS: sandboxChannel('SMS'),
  WHATSAPP: sandboxChannel('WHATSAPP'),
};

export const messaging = (channel: ContactChannel) => adapters[channel];
