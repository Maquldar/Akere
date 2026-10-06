import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Prisma } from '@prisma/client';
import { EsutdQuery, EsutdSubmitInput } from '@akere/shared';
import { prisma } from '../../lib/db';
import { can, requireUser } from '../../lib/auth';
import { on } from '../../lib/hooks';
import { pageArgs, toPage } from '../../lib/pagination';
import { registerJob } from '../../jobs';
import { registerInboxCounter } from '../me/routes';
import { backfillSubmissions, ensureSubmissionFor, esutdCounts, esutdInclude, esutdScope, processEsutdQueue, submitDocuments, toEsutdItems } from './service';

// A completed document whose type requires ЕСУТД registration appears in the registry as NOT_SENT.
on('document.completed', async (p, tx) => {
  await ensureSubmissionFor(tx ?? prisma, p.documentId);
});

// Queue processing every minute.
registerJob('esutd-queue', '* * * * *', async () => {
  await processEsutdQueue();
});

// Sidebar badge (HR): documents still to send + errors.
registerInboxCounter('esutd', async (u) => {
  if (!can(u, 'esutd.read')) return 0;
  const c = await esutdCounts(u);
  return c.notSent + c.errors;
});

export default async function esutdRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get('/', { schema: { querystring: EsutdQuery } }, async (req) => {
    const u = requireUser(req, 'esutd.read');
    await backfillSubmissions(u.tenantId);
    const q = req.query;
    const doc: Prisma.DocumentWhereInput = {
      ...(q.legalEntityId ? { legalEntityId: q.legalEntityId } : {}),
      ...(q.q ? { searchText: { contains: q.q.toLowerCase(), mode: 'insensitive' } } : {}),
    };
    const where: Prisma.EsutdSubmissionWhereInput = { AND: [esutdScope(u), { document: doc }, ...(q.status ? [{ status: q.status }] : [])] };
    const [rows, total] = await Promise.all([
      prisma.esutdSubmission.findMany({
        where, include: esutdInclude, ...pageArgs(q),
        // Not sent first (enum order NOT_SENT, QUEUED, SENT, ERROR), then by registration date.
        orderBy: [{ status: 'asc' }, { document: { registeredAt: { sort: 'desc', nulls: 'last' } } }, { documentId: 'asc' }],
      }),
      prisma.esutdSubmission.count({ where }),
    ]);
    return toPage(await toEsutdItems(rows), total, q);
  });

  app.post('/submit', { schema: { body: EsutdSubmitInput } }, async (req) => {
    const u = requireUser(req, 'esutd.submit');
    return submitDocuments(u, req.body.documentIds);
  });

  app.get('/count', async (req) => {
    const u = requireUser(req, 'esutd.read');
    return esutdCounts(u);
  });
}
