import type { FastifyInstance } from 'fastify';
import planningRoutes from './planning';
import trackingRoutes from './tracking';
import requestRoutes from './requests';
import timesheetRoutes from './timesheet';

/** Time tracking module (API.md §13, F-37…F-43), mounted at /time. */
export default async function timeRoutes(app: FastifyInstance) {
  await app.register(trackingRoutes);
  await app.register(planningRoutes);
  await app.register(requestRoutes);
  await app.register(timesheetRoutes);
}
