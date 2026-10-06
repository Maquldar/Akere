import type { FastifyInstance } from 'fastify';
import authRoutes from './auth/routes';
import meRoutes from './me/routes';
import orgRoutes from './org/routes';
import filesRoutes from './files/routes';
import healthRoutes from './health/routes';

/** Every module is a Fastify plugin. Later phases append here (one line per module). */
export async function registerModules(app: FastifyInstance) {
  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(meRoutes, { prefix: '/me' });
  await app.register(orgRoutes, { prefix: '/org' });
  await app.register(filesRoutes, { prefix: '/files' });
}
