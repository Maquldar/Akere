import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { DeputyFilter, DeputyInput, id } from '@akere/shared';
import { prisma } from '../../lib/db';
import { hasRole, requireUser } from '../../lib/auth';
import { businessRule, forbidden, notFound } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { fromDateStr, todayUtc } from '../../lib/dates';
import { deputyInclude, toDeputyItem } from './service';

/** Deputies (F-19): a principal delegates approval/signing to another user for a date range. */
export default async function deputiesRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get('/', { schema: { querystring: DeputyFilter } }, async (req) => {
    const u = requireUser(req, 'deputy.read');
    const seeAll = hasRole(u, 'ADMIN', 'HR') && !req.query.mine;
    const where: Prisma.DeputyWhereInput = {
      tenantId: u.tenantId,
      ...(seeAll ? {} : { OR: [{ principalUserId: u.userId }, { deputyUserId: u.userId }] }),
      endDate: { gte: new Date(todayUtc().getTime() - 90 * 86_400_000) }, // recent and current only
    };
    const rows = await prisma.deputy.findMany({ where, include: deputyInclude, orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }] });
    return rows.map(toDeputyItem);
  });

  app.post('/', { schema: { body: DeputyInput } }, async (req, reply) => {
    const u = requireUser(req, 'deputy.manage');
    const principalUserId = req.body.principalUserId ?? u.userId;
    if (principalUserId !== u.userId && !hasRole(u, 'ADMIN')) throw forbidden('Only administrators can assign deputies for other users');
    if (principalUserId === req.body.deputyUserId) throw businessRule('SELF_DEPUTY', 'A user cannot be their own deputy');
    if (fromDateStr(req.body.endDate) < todayUtc()) throw businessRule('PAST_PERIOD', 'The period has already ended');
    const users = await prisma.user.findMany({ where: { id: { in: [principalUserId, req.body.deputyUserId] }, tenantId: u.tenantId, isActive: true } });
    if (users.length !== 2) throw notFound('User');
    const d = await prisma.deputy.create({
      data: { tenantId: u.tenantId, principalUserId, deputyUserId: req.body.deputyUserId, startDate: fromDateStr(req.body.startDate), endDate: fromDateStr(req.body.endDate) },
      include: deputyInclude,
    });
    await audit(u, 'deputy.create', 'Deputy', d.id, { principalUserId, deputyUserId: d.deputyUserId, startDate: req.body.startDate, endDate: req.body.endDate }, { ip: req.ip });
    return reply.status(201).send(toDeputyItem(d));
  });

  app.delete('/:id', { schema: { params: z.object({ id }) } }, async (req, reply) => {
    const u = requireUser(req, 'deputy.manage');
    const d = await prisma.deputy.findFirst({ where: { id: req.params.id, tenantId: u.tenantId } });
    if (!d) throw notFound('Deputy');
    if (d.principalUserId !== u.userId && !hasRole(u, 'ADMIN')) throw forbidden();
    await prisma.deputy.delete({ where: { id: d.id } });
    await audit(u, 'deputy.delete', 'Deputy', d.id, {}, { ip: req.ip });
    return reply.status(204).send();
  });
}
