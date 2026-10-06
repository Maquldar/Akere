import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { CampaignInput, CampaignUpdate, VacationApproveInput, VacationGridQuery, VacationPlanInput, id } from '@akere/shared';
import { prisma } from '../../lib/db';
import { can, requireUser } from '../../lib/auth';
import { businessRule } from '../../lib/errors';
import { registerJob } from '../../jobs';
import { buildScheduleXlsx } from './export';
import {
  campaignViews, createCampaign, decidePlans, findCampaign, grid, planRow, runVacationReminders, savePlan, updateCampaign,
} from './service';

registerJob('vacation-reminders', '0 9 * * *', async () => {
  await runVacationReminders();
});

const idParam = z.object({ id });

/** Vacation schedule (API.md §9, F-33). */
export default async function vacationScheduleRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get('/campaigns', async (req) => {
    const u = requireUser(req, 'vacation.read');
    const rows = await prisma.vacationCampaign.findMany({
      where: { tenantId: u.tenantId, ...(can(u, 'vacation.manage') ? {} : { status: { not: 'DRAFT' } }) },
      orderBy: { year: 'desc' },
    });
    return campaignViews(u, rows);
  });

  app.post('/campaigns', { schema: { body: CampaignInput } }, async (req, reply) => {
    const u = requireUser(req, 'vacation.manage');
    const c = await createCampaign(u, req.body);
    return reply.status(201).send((await campaignViews(u, [c]))[0]);
  });

  app.patch('/campaigns/:id', { schema: { params: idParam, body: CampaignUpdate } }, async (req) => {
    const u = requireUser(req, 'vacation.manage');
    const c = await findCampaign(u, req.params.id);
    const updated = await updateCampaign(u, c, req.body);
    return (await campaignViews(u, [updated]))[0];
  });

  app.get('/campaigns/:id/grid', { schema: { params: idParam, querystring: VacationGridQuery } }, async (req) => {
    const u = requireUser(req, 'vacation.read');
    const c = await findCampaign(u, req.params.id);
    return grid(u, c, req.query);
  });

  app.get('/campaigns/:id/my-plan', { schema: { params: idParam } }, async (req) => {
    const u = requireUser(req, 'vacation.read');
    if (!u.employeeId) throw businessRule('NO_EMPLOYEE_RECORD', 'Only employees have a vacation plan');
    const c = await findCampaign(u, req.params.id);
    return planRow(u, c, u.employeeId);
  });

  app.put('/campaigns/:id/plans/:employeeId', { schema: { params: z.object({ id, employeeId: id }), body: VacationPlanInput } }, async (req) => {
    const u = requireUser(req, 'vacation.read');
    const c = await findCampaign(u, req.params.id);
    return savePlan(u, c, req.params.employeeId, req.body);
  });

  app.post('/campaigns/:id/approve', { schema: { params: idParam, body: VacationApproveInput } }, async (req) => {
    const u = requireUser(req, 'vacation.approve');
    const c = await findCampaign(u, req.params.id);
    return decidePlans(u, c, req.body);
  });

  app.get('/campaigns/:id/export', { schema: { params: idParam, querystring: VacationGridQuery.omit({ page: true, pageSize: true }) } }, async (req, reply) => {
    const u = requireUser(req, 'vacation.read');
    const c = await findCampaign(u, req.params.id);
    const buf = await buildScheduleXlsx(u, c, req.query);
    const name = `График отпусков ${c.year}.xlsx`;
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`)
      .send(buf);
  });
}
