import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { MeUpdate, boolQuery, id, pageQuery } from '@akere/shared';
import { prisma } from '../../lib/db';
import { requireUser } from '../../lib/auth';
import { pageArgs, toPage } from '../../lib/pagination';
import { buildMe } from '../auth/me';

/** Badge counters are contributed by modules so this file never needs editing per phase. */
type Counter = (u: ReturnType<typeof requireUser>) => Promise<number>;
const counters: Record<string, Counter> = {};
export const registerInboxCounter = (key: string, fn: Counter) => {
  counters[key] = fn;
};

export default async function meRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.patch('/', { schema: { body: MeUpdate } }, async (req) => {
    const u = requireUser(req);
    await prisma.user.update({ where: { id: u.userId }, data: req.body });
    return buildMe(u.userId);
  });

  app.get('/notifications', { schema: { querystring: pageQuery.extend({ unread: boolQuery.optional() }) } }, async (req) => {
    const u = requireUser(req);
    const where = { userId: u.userId, ...(req.query.unread ? { readAt: null } : {}) };
    const [items, total] = await Promise.all([
      prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(req.query) }),
      prisma.notification.count({ where }),
    ]);
    return toPage(
      items.map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, link: n.link, readAt: n.readAt?.toISOString() ?? null, createdAt: n.createdAt.toISOString() })),
      total,
      req.query,
    );
  });

  app.post('/notifications/read', { schema: { body: z.object({ ids: z.array(id).max(500).optional() }) } }, async (req, reply) => {
    const u = requireUser(req);
    await prisma.notification.updateMany({
      where: { userId: u.userId, readAt: null, ...(req.body.ids ? { id: { in: req.body.ids } } : {}) },
      data: { readAt: new Date() },
    });
    return reply.status(204).send();
  });

  app.get('/inbox-counts', async (req) => {
    const u = requireUser(req);
    const result: Record<string, number> = { documents: 0, requests: 0, vnd: 0, timeRequests: 0 };
    for (const [key, fn] of Object.entries(counters)) result[key] = await fn(u);
    return result;
  });
}
