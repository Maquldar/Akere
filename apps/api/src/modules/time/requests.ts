import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { TimeRequestDecisionInput, TimeRequestInput, TimeRequestsQuery, id, type TimeRequestView } from '@akere/shared';
import { prisma } from '../../lib/db';
import { requireUser } from '../../lib/auth';
import { badRequest, businessRule, conflict, forbidden, notFound } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { notify } from '../../lib/notify';
import { fromDateStr } from '../../lib/dates';
import { pageArgs, toPage } from '../../lib/pagination';
import { dateStrOf, localToUtc, shiftInstants, tenantTimezone, timeToMinutes, todayLocal, addDaysStr } from '../../lib/calendar';
import { registerInboxCounter } from '../me/routes';
import { DAY_OFF_WORK_TITLE } from './compute';
import { empRef, empRefInclude, requestInclude, requestView } from './views';
import { assertManaged, deciderRefs, managedWhere, pendingRequestsToDecide } from './service';

registerInboxCounter('timeRequests', pendingRequestsToDecide);

const KIND_LABEL = { CORRECTION: 'Корректировка отметок', DAY_OFF_WORK: 'Работа в выходной/праздничный день', SUBSTITUTION: 'Замена смены' } as const;

export default async function requestRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get('/requests', { schema: { querystring: TimeRequestsQuery } }, async (req) => {
    const u = requireUser(req, 'time.self');
    const q = req.query;
    let employee: Prisma.EmployeeWhereInput;
    if (q.scope === 'managed') {
      if (!u.permissions.includes('time.manage')) throw forbidden();
      employee = await managedWhere(u, u.employeeId ? { id: { not: u.employeeId } } : {});
    } else employee = { id: u.employeeId ?? '__none__' };
    const where: Prisma.TimeRequestWhereInput = { tenantId: u.tenantId, employee, ...(q.status ? { status: q.status } : {}), ...(q.kind ? { kind: q.kind } : {}) };
    const [rows, total] = await Promise.all([
      prisma.timeRequest.findMany({ where, include: requestInclude, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], ...pageArgs(q) }),
      prisma.timeRequest.count({ where }),
    ]);
    const deciders = await deciderRefs(rows.map((r) => r.decidedById));
    return toPage(rows.map((r) => requestView(r, deciders)), total, q);
  });

  app.post('/requests', { schema: { body: TimeRequestInput } }, async (req, reply): Promise<TimeRequestView> => {
    const u = requireUser(req, 'time.self');
    if (!u.employeeId) throw forbidden('No employee record');
    const tz = await tenantTimezone(u.tenantId);
    const today = todayLocal(tz);
    const b = req.body;
    let date: string;
    let data: Prisma.InputJsonObject;
    if (b.kind === 'CORRECTION') {
      if (!b.in && !b.out) throw badRequest('Specify arrival or departure time', { fieldErrors: { in: ['in or out is required'] }, formErrors: [] });
      if (b.date > today) throw businessRule('DATE_IN_FUTURE', 'Corrections are only possible for past days');
      date = b.date;
      data = { ...(b.in ? { in: b.in } : {}), ...(b.out ? { out: b.out } : {}), reason: b.reason };
    } else if (b.kind === 'DAY_OFF_WORK') {
      if (b.start === b.end) throw badRequest('Start and end must differ', { fieldErrors: { end: ['Must differ from start'] }, formErrors: [] });
      date = b.date;
      data = { start: b.start, end: b.end, reason: b.reason };
    } else {
      const shift = await prisma.shift.findFirst({ where: { id: b.shiftId, tenantId: u.tenantId, employeeId: u.employeeId } });
      if (!shift) throw notFound('Shift');
      if (dateStrOf(shift.date) < today) throw businessRule('SHIFT_IN_PAST', 'This shift is already over');
      if (b.substituteEmployeeId === u.employeeId) throw badRequest('Choose another employee', { fieldErrors: { substituteEmployeeId: ['Cannot be yourself'] }, formErrors: [] });
      const sub = await prisma.employee.findFirst({ where: { id: b.substituteEmployeeId, tenantId: u.tenantId, status: 'ACTIVE' }, include: empRefInclude });
      if (!sub) throw notFound('Employee');
      date = dateStrOf(shift.date);
      data = { shiftId: shift.id, shiftTitle: shift.title, substituteEmployeeId: sub.id, substituteName: empRef(sub).fullName, reason: b.reason };
    }
    const dup = await prisma.timeRequest.findFirst({ where: { employeeId: u.employeeId, kind: b.kind, date: fromDateStr(date), status: 'PENDING' } });
    if (dup) throw conflict('A pending request of this kind already exists for this day');
    const r = await prisma.timeRequest.create({ data: { tenantId: u.tenantId, employeeId: u.employeeId, kind: b.kind, date: fromDateStr(date), data }, include: requestInclude });
    const me = await prisma.employee.findUniqueOrThrow({ where: { id: u.employeeId }, select: { managerId: true } });
    if (me.managerId) {
      const mgr = await prisma.employee.findUnique({ where: { id: me.managerId }, select: { userId: true } });
      if (mgr) {
        await notify({
          tenantId: u.tenantId, userId: mgr.userId, type: 'time.request_created', title: `${KIND_LABEL[b.kind]}: ${empRef(r.employee).shortName}`,
          body: `Дата: ${date}. ${b.reason}`, link: '/time/timesheet?tab=requests', email: false,
        });
      }
    }
    await audit(u, 'time.request_create', 'TimeRequest', r.id, { kind: b.kind, date }, { ip: req.ip });
    reply.status(201);
    return requestView(r, new Map());
  });

  app.post('/requests/:id/decide', { schema: { params: z.object({ id }), body: TimeRequestDecisionInput } }, async (req): Promise<TimeRequestView> => {
    const u = requireUser(req, 'time.manage');
    const r0 = await prisma.timeRequest.findFirst({ where: { id: req.params.id, tenantId: u.tenantId } });
    if (!r0) throw notFound('Request');
    if (r0.employeeId === u.employeeId) throw forbidden('You cannot decide your own request');
    await assertManaged(u, r0.employeeId);
    if (r0.status !== 'PENDING') throw conflict('Request is already decided');
    const tz = await tenantTimezone(u.tenantId);
    const approve = req.body.decision === 'APPROVE';
    const date = dateStrOf(r0.date);
    const d = (r0.data ?? {}) as Record<string, string>;
    let substituteUserId: string | null = null;

    await prisma.$transaction(async (tx) => {
      // Claim the request first so two deciders can't both apply it.
      const claimed = await tx.timeRequest.updateMany({
        where: { id: r0.id, status: 'PENDING' },
        data: { status: approve ? 'APPROVED' : 'REJECTED', decidedById: u.userId, decidedAt: new Date(), comment: req.body.comment ?? null },
      });
      if (!claimed.count) throw conflict('Request is already decided');
      if (!approve) return;
      if (r0.kind === 'CORRECTION') {
        const marks: Prisma.TimeMarkCreateManyInput[] = [];
        if (d.in) marks.push({ tenantId: u.tenantId, employeeId: r0.employeeId, type: 'IN', at: localToUtc(date, d.in, tz), source: 'CORRECTION', verification: 'SKIPPED', verificationNote: `Корректировка: ${d.reason ?? ''}`.trim() });
        if (d.out) {
          const outDate = d.in && timeToMinutes(d.out) <= timeToMinutes(d.in) ? addDaysStr(date, 1) : date;
          marks.push({ tenantId: u.tenantId, employeeId: r0.employeeId, type: 'OUT', at: localToUtc(outDate, d.out, tz), source: 'CORRECTION', verification: 'SKIPPED', verificationNote: `Корректировка: ${d.reason ?? ''}`.trim() });
        }
        await tx.timeMark.createMany({ data: marks });
      } else if (r0.kind === 'DAY_OFF_WORK') {
        if (await tx.shift.findFirst({ where: { employeeId: r0.employeeId, date: r0.date } })) throw businessRule('ALREADY_SCHEDULED', 'Employee already has a shift on this day');
        const emp = await tx.employee.findUniqueOrThrow({ where: { id: r0.employeeId }, select: { locationId: true } });
        const { startAt, endAt } = shiftInstants(date, d.start!, d.end!, tz);
        const span = (endAt.getTime() - startAt.getTime()) / 60_000;
        await tx.shift.create({
          data: {
            tenantId: u.tenantId, employeeId: r0.employeeId, date: r0.date, startAt, endAt, breakMinutes: span > 6 * 60 ? 60 : 0,
            title: DAY_OFF_WORK_TITLE, color: 'purple', status: 'PUBLISHED', locationId: emp.locationId, createdById: u.userId,
          },
        });
      } else {
        const shift = await tx.shift.findFirst({ where: { id: d.shiftId, tenantId: u.tenantId } });
        if (!shift || shift.employeeId !== r0.employeeId) throw businessRule('SHIFT_CHANGED', 'The shift no longer belongs to the requester');
        const sub = await tx.employee.findFirst({ where: { id: d.substituteEmployeeId, tenantId: u.tenantId, status: 'ACTIVE' }, select: { id: true, userId: true } });
        if (!sub) throw businessRule('SUBSTITUTE_UNAVAILABLE', 'The substitute is no longer active');
        if (await tx.shift.findFirst({ where: { employeeId: sub.id, date: shift.date } })) throw businessRule('ALREADY_SCHEDULED', 'The substitute already has a shift on this day');
        await tx.shift.update({ where: { id: shift.id }, data: { employeeId: sub.id } });
        substituteUserId = sub.userId;
      }
    });

    const r = await prisma.timeRequest.findUniqueOrThrow({ where: { id: r0.id }, include: requestInclude });
    await notify({
      tenantId: u.tenantId, userId: r.employee.userId, type: approve ? 'time.request_approved' : 'time.request_rejected',
      title: `${KIND_LABEL[r.kind]} ${approve ? 'согласована' : 'отклонена'}`, body: `Дата: ${date}${req.body.comment ? `. ${req.body.comment}` : ''}`, link: '/time', email: false,
    });
    if (substituteUserId) {
      await notify({ tenantId: u.tenantId, userId: substituteUserId, type: 'time.substitution', title: `Вас назначили на замену ${date}`, body: d.shiftTitle ?? '', link: '/time', email: false });
    }
    await audit(u, 'time.request_decide', 'TimeRequest', r.id, { decision: req.body.decision, kind: r.kind }, { ip: req.ip });
    return requestView(r, await deciderRefs([r.decidedById]));
  });
}
