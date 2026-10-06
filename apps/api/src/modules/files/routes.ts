import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { boolQuery, id } from '@akere/shared';
import { prisma } from '../../lib/db';
import { storage } from '../../adapters/storage';
import { canAccessFile } from '../../lib/files';
import { notFound, unauthenticated } from '../../lib/errors';

export default async function filesRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get('/:id', { schema: { params: z.object({ id }), querystring: z.object({ download: boolQuery.optional() }) } }, async (req, reply) => {
    const a = req.auth;
    if (!a || (a.kind === 'user' && a.pending2fa)) throw unauthenticated();
    const file = await prisma.storedFile.findUnique({ where: { id: req.params.id } });
    if (!file || !(await canAccessFile(a, file))) throw notFound('File');
    const body = await storage.get(file.key);
    const disposition = req.query.download || !/^(application\/pdf|image\/(jpeg|png))$/.test(file.mime) ? 'attachment' : 'inline';
    return reply
      .header('Content-Type', file.mime)
      .header('Content-Length', String(body.length))
      .header('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(file.filename)}`)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, max-age=300')
      .send(body);
  });
}
