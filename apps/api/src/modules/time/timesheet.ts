import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { BoardQuery, T13ConfirmInput, T13Query, type T13Sheet, type TodayBoard } from '@akere/shared';
import { prisma } from '../../lib/db';
import { requireUser } from '../../lib/auth';
import { businessRule, forbidden } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { buildBoard, buildT13 } from './service';
import { renderT13Xlsx } from './t13-xlsx';

/** Managers with active direct reports and how many of them confirmed the month (tenant-wide). */
export async function confirmationStatus(tenantId: string, year: number, month: number) {
  const managers = await prisma.employee.findMany({
    where: { tenantId, status: 'ACTIVE', managerId: { not: null } },
    select: { managerId: true },
    distinct: ['managerId'],
  });
  const ids = managers.map((m) => m.managerId!);
  const confirmed = ids.length ? await prisma.timesheetConfirmation.count({ where: { tenantId, year, month, managerEmployeeId: { in: ids } } }) : 0;
  return { confirmed, total: ids.length };
}

export default async function timesheetRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get('/board', { schema: { querystring: BoardQuery } }, async (req): Promise<TodayBoard> => {
    const u = requireUser(req, 'time.manage');
    return buildBoard(u, req.query);
  });

  app.get('/t13', { schema: { querystring: T13Query } }, async (req): Promise<T13Sheet> => {
    const u = requireUser(req, 'time.self');
    const { meta: _m, rowsMeta: _r, ...sheet } = await buildT13(u, req.query);
    return sheet;
  });

  app.post('/t13/confirm', { schema: { body: T13ConfirmInput } }, async (req) => {
    const u = requireUser(req, 'time.manage');
    if (!u.employeeId) throw forbidden('No employee record');
    const { year, month } = req.body;
    const reports = await prisma.employee.count({ where: { tenantId: u.tenantId, managerId: u.employeeId, status: 'ACTIVE' } });
    if (!reports) throw businessRule('NO_SUBORDINATES', 'Only managers with subordinates confirm the timesheet');
    await prisma.timesheetConfirmation.upsert({
      where: { managerEmployeeId_year_month: { managerEmployeeId: u.employeeId, year, month } },
      create: { tenantId: u.tenantId, managerEmployeeId: u.employeeId, year, month },
      update: { confirmedAt: new Date() },
    });
    await audit(u, 'time.t13_confirm', 'TimesheetConfirmation', null, { year, month }, { ip: req.ip });
    return confirmationStatus(u.tenantId, year, month);
  });

  app.get('/t13/export', { schema: { querystring: T13Query } }, async (req, reply) => {
    const u = requireUser(req, 'time.export');
    const sheet = await buildT13(u, req.query);
    const buf = await renderT13Xlsx(sheet);
    const name = `T-13_${req.query.year}-${String(req.query.month).padStart(2, '0')}.xlsx`;
    await audit(u, 'time.t13_export', 'Timesheet', null, { year: req.query.year, month: req.query.month, rows: sheet.rows.length }, { ip: req.ip });
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(`Табель_Т-13_${req.query.year}-${String(req.query.month).padStart(2, '0')}.xlsx`)}`)
      .send(buf);
  });
}
