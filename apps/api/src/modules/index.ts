import type { FastifyInstance } from 'fastify';
import authRoutes from './auth/routes';
import meRoutes from './me/routes';
import orgRoutes from './org/routes';
import filesRoutes from './files/routes';
import healthRoutes from './health/routes';
import timeRoutes from './time/routes';
import absenceRoutes from './absences/routes';
import sickLeaveRoutes from './sick-leaves/routes';
import onboardingRoutes from './onboarding/routes';
import candidatesRoutes from './candidates/routes';
import portalRoutes from './portal/routes';
import documentsRoutes from './documents/routes';
import signingRoutes from './signing/routes';
import employeesRoutes from './employees/routes';
import deputiesRoutes from './deputies/routes';

/** Every module is a Fastify plugin. Later phases append here (one line per module). */
export async function registerModules(app: FastifyInstance) {
  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(meRoutes, { prefix: '/me' });
  await app.register(orgRoutes, { prefix: '/org' });
  await app.register(filesRoutes, { prefix: '/files' });
  await app.register(timeRoutes, { prefix: '/time' });
  await app.register(absenceRoutes, { prefix: '/absences' });
  await app.register(sickLeaveRoutes, { prefix: '/sick-leaves' });
  await app.register(onboardingRoutes, { prefix: '/onboarding' });
  await app.register(candidatesRoutes, { prefix: '/candidates' });
  await app.register(portalRoutes, { prefix: '/portal' });
  await app.register(documentsRoutes); // /documents, /document-types, /document-templates, /route-templates
  await app.register(signingRoutes, { prefix: '/signing' });
  await app.register(employeesRoutes, { prefix: '/employees' });
  await app.register(deputiesRoutes, { prefix: '/deputies' });
}
