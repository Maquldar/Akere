import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { HelpArticlesQuery, SupportTicketInput, type HelpArticle } from '@akere/shared';
import { prisma } from '../../lib/db';
import { requireUser } from '../../lib/auth';
import { audit } from '../../lib/audit';
import { escapeHtml } from '../../lib/notify';
import { fullName } from '../../lib/names';
import { messaging } from '../../adapters/messaging';
import { config } from '../../config';
import { articles as ru } from './content/ru';
import { articles as kk } from './content/kk';
import { articles as en } from './content/en';

type Lang = 'ru' | 'kk' | 'en';
const CONTENT: Record<Lang, HelpArticle[]> = { ru, kk, en };

/** ?lang wins, then the first supported Accept-Language tag, then the user's locale, then ru. */
export function helpLang(req: FastifyRequest, explicit?: string, userLocale?: string): Lang {
  const ok = (l: string | undefined): l is Lang => l === 'ru' || l === 'kk' || l === 'en';
  if (ok(explicit)) return explicit;
  const header = String(req.headers['accept-language'] ?? '');
  for (const part of header.split(',')) {
    const tag = part.split(';')[0]!.trim().toLowerCase().slice(0, 2);
    if (ok(tag)) return tag;
  }
  return ok(userLocale) ? userLocale : 'ru';
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');

/** All words must match (title or body); title matches rank first. */
export function searchArticles(list: HelpArticle[], q?: string): HelpArticle[] {
  const words = q ? norm(q).split(/\s+/).filter((w) => w.length > 0) : [];
  if (!words.length) return list;
  return list
    .map((a, i) => {
      const title = norm(a.title);
      const text = `${title} ${norm(a.body)} ${a.category} ${a.slug}`;
      if (!words.every((w) => text.includes(w))) return null;
      return { a, i, score: words.filter((w) => title.includes(w)).length };
    })
    .filter((x): x is { a: HelpArticle; i: number; score: number } => !!x)
    .sort((x, y) => y.score - x.score || x.i - y.i)
    .map((x) => x.a);
}

export default async function helpRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get('/articles', { schema: { querystring: HelpArticlesQuery } }, async (req) => {
    const u = requireUser(req);
    return searchArticles(CONTENT[helpLang(req, req.query.lang, u.locale)], req.query.q);
  });

  app.post('/tickets', { schema: { body: SupportTicketInput }, config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req, reply) => {
    const u = requireUser(req);
    const [user, tenant] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: u.userId }, select: { email: true, phone: true, firstName: true, lastName: true, middleName: true } }),
      prisma.tenant.findUniqueOrThrow({ where: { id: u.tenantId }, select: { name: true } }),
    ]);
    const ticket = await prisma.supportTicket.create({ data: { tenantId: u.tenantId, userId: u.userId, subject: req.body.subject, message: req.body.message } });
    const from = `${fullName(user)} <${user.email}>${user.phone ? `, ${user.phone}` : ''}`;
    const subject = `[Akere HR #${ticket.id.slice(-8)}] ${req.body.subject}`;
    const text = `Обращение в службу поддержки\n\nКомпания: ${tenant.name}\nОт: ${from}\nРоли: ${u.roles.join(', ')}\nНомер: ${ticket.id}\n\n${req.body.message}`;
    const html = `<div style="font-family:Inter,Arial,sans-serif;max-width:640px"><h2 style="font-size:18px">${escapeHtml(req.body.subject)}</h2>`
      + `<p><b>Компания:</b> ${escapeHtml(tenant.name)}<br><b>От:</b> ${escapeHtml(from)}<br><b>Роли:</b> ${escapeHtml(u.roles.join(', '))}<br><b>Номер:</b> ${ticket.id}</p>`
      + `<p style="white-space:pre-wrap">${escapeHtml(req.body.message)}</p></div>`;
    await messaging('EMAIL').send({ tenantId: u.tenantId, to: config.SUPPORT_EMAIL, subject, text, html });
    await audit(u, 'support.ticket', 'SupportTicket', ticket.id, { subject: req.body.subject }, { ip: req.ip });
    return reply.status(201).send({ id: ticket.id });
  });
}
