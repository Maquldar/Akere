import type { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/db';
import { storage } from '../../adapters/storage';

export default async function healthRoutes(app: FastifyInstance) {
  app.get('/health', { config: { rateLimit: false } }, async (_req, reply) => {
    const db = await prisma.$queryRaw`SELECT 1`.then(() => 'ok').catch(() => 'down');
    const store = await storage.health().then(() => 'ok').catch(() => 'down');
    const ok = db === 'ok' && store === 'ok';
    return reply.status(ok ? 200 : 503).send({ status: ok ? 'ok' : 'degraded', db, storage: store, version: process.env.npm_package_version ?? '0.1.0' });
  });
}
