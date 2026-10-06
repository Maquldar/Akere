import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Prisma } from '@prisma/client';
import { AbsencesQuery, type AbsenceView } from '@akere/shared';
import { prisma } from '../../lib/db';
import { requireUser } from '../../lib/auth';
import { badRequest } from '../../lib/errors';
import { employeeScope } from '../../lib/scope';
import { fromDateStr } from '../../lib/dates';
import { absenceView } from '../time/views';

const MAX_ROWS = 2000;

/** Absences (API.md §12): read-only, scoped (HR → legal entities, manager → subtree, employee → self). */
export default async function absenceRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get('/', { schema: { querystring: AbsencesQuery } }, async (req): Promise<AbsenceView[]> => {
    const u = requireUser(req);
    const q = req.query;
    if (q.from && q.to && q.to < q.from) throw badRequest('`to` must not be before `from`');
    const employee: Prisma.EmployeeWhereInput = {
      AND: [await employeeScope(u), ...(q.employeeId ? [{ id: q.employeeId }] : []), ...(q.departmentId ? [{ departmentId: q.departmentId }] : [])],
    };
    const rows = await prisma.absence.findMany({
      where: {
        tenantId: u.tenantId,
        employee,
        ...(q.kind ? { kind: q.kind } : {}),
        ...(q.to ? { startDate: { lte: fromDateStr(q.to) } } : {}),
        ...(q.from ? { endDate: { gte: fromDateStr(q.from) } } : {}),
      },
      orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }],
      take: MAX_ROWS,
    });
    return rows.map(absenceView);
  });
}
