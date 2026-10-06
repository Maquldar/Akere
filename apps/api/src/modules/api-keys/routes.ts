import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ApiKeyInput, id } from '@akere/shared';
import { prisma } from '../../lib/db';
import { requireUser } from '../../lib/auth';
import { notFound } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { createApiKey, toApiKeyView } from './service';

export default async function apiKeysRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get('/', async (req) => {
    const u = requireUser(req, 'apikey.manage');
    const rows = await prisma.apiKey.findMany({ where: { tenantId: u.tenantId }, orderBy: [{ revokedAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }] });
    return rows.map(toApiKeyView);
  });

  app.post('/', { schema: { body: ApiKeyInput } }, async (req, reply) => {
    const u = requireUser(req, 'apikey.manage');
    const { row, key } = await prisma.$transaction(async (tx) => {
      const created = await createApiKey(tx, { tenantId: u.tenantId, name: req.body.name, scopes: req.body.scopes, createdById: u.userId });
      await audit(u, 'apikey.create', 'ApiKey', created.row.id, { name: req.body.name, scopes: created.row.scopes, prefix: created.row.prefix }, { ip: req.ip, tx });
      return created;
    });
    // The plaintext key is returned exactly once.
    return reply.status(201).send({ ...toApiKeyView(row), key });
  });

  app.delete('/:id', { schema: { params: z.object({ id }) } }, async (req, reply) => {
    const u = requireUser(req, 'apikey.manage');
    const k = await prisma.apiKey.findFirst({ where: { id: req.params.id, tenantId: u.tenantId } });
    if (!k) throw notFound('API key');
    if (!k.revokedAt) {
      await prisma.apiKey.update({ where: { id: k.id }, data: { revokedAt: new Date() } });
      await audit(u, 'apikey.revoke', 'ApiKey', k.id, { name: k.name, prefix: k.prefix }, { ip: req.ip });
    }
    return reply.status(204).send();
  });
}
