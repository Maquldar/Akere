import { messaging } from '../adapters/messaging';
import { prisma, type Tx } from './db';
import { config } from '../config';

export type NotifyInput = { tenantId: string; userId: string; type: string; title: string; body?: string; link?: string; email?: boolean };

/** In-app notification + optional email (F-23). Email failures never break the caller. */
export async function notify(n: NotifyInput, tx: Tx = prisma) {
  await tx.notification.create({
    data: { tenantId: n.tenantId, userId: n.userId, type: n.type, title: n.title, body: n.body ?? null, link: n.link ?? null },
  });
  if (n.email !== false) {
    const user = await tx.user.findUnique({ where: { id: n.userId }, select: { email: true } });
    if (user) {
      const url = n.link ? `${config.APP_URL}${n.link}` : config.APP_URL;
      const text = `${n.title}\n\n${n.body ?? ''}\n\n${url}`;
      const html = `<div style="font-family:Inter,Arial,sans-serif;max-width:560px"><h2 style="font-size:18px">${escapeHtml(n.title)}</h2><p>${escapeHtml(n.body ?? '')}</p><p><a href="${url}" style="background:#2433d6;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Открыть в Akere HR</a></p></div>`;
      messaging('EMAIL').send({ tenantId: n.tenantId, to: user.email, subject: n.title, text, html }).catch(() => undefined);
    }
  }
}

export const notifyMany = async (items: NotifyInput[], tx: Tx = prisma) => {
  for (const n of items) await notify(n, tx);
};

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
