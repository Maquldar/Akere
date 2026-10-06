import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import {
  ClaimDecisionInput, CopyWeekInput, PublishShiftsInput, ScheduleQuery, ShiftInput, ShiftPatternInput, ShiftTemplateInput, ShiftTemplateUpdate,
  ShiftUpdate, id, type ScheduleView,
} from '@akere/shared';
import { prisma, type Tx } from '../../lib/db';
import { requireUser, type UserCtx } from '../../lib/auth';
import { badRequest, businessRule, conflict, forbidden, notFound } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { notify } from '../../lib/notify';
import { isHrOrAdmin } from '../../lib/scope';
import { fromDateStr } from '../../lib/dates';
import {
  addDaysStr, dateStrOf, datesInRange, diffDays, holidaysInRange, isPublicHoliday, isWorkingDay, buildCalendar, normHoursFor, shiftInstants,
  localTimeStr, tenantTimezone, todayLocal,
} from '../../lib/calendar';
import { hours1, patternWorks, plannedMinutesOf } from './compute';
import { absenceView, empRef, empRefInclude, shiftInclude, shiftView, templateInclude, templateView, type ShiftRow } from './views';
import { assertManaged, assertManagedMany, canManageOpenShift, employeeFilter, managedWhere } from './service';

const idParam = z.object({ id });
const MAX_RANGE_DAYS = 93;

function assertRange(from: string, to: string, max = MAX_RANGE_DAYS) {
  if (to < from) throw badRequest('`to` must not be before `from`', { fieldErrors: { to: ['Must not be before from'] }, formErrors: [] });
  if (diffDays(from, to) + 1 > max) throw badRequest(`Range is limited to ${max} days`, { fieldErrors: { to: [`Max ${max} days`] }, formErrors: [] });
}

async function assertLocation(tenantId: string, locationId: string | null | undefined) {
  if (locationId && !(await prisma.workLocation.findFirst({ where: { id: locationId, tenantId } }))) throw notFound('Location');
}

/** Loads a shift the user may manage (404 for unknown, 403 outside scope). */
async function loadManagedShift(u: UserCtx, shiftId: string, tx: Tx = prisma): Promise<ShiftRow> {
  const s = await tx.shift.findFirst({ where: { id: shiftId, tenantId: u.tenantId }, include: shiftInclude });
  if (!s) throw notFound('Shift');
  if (s.employeeId) await assertManaged(u, s.employeeId, tx);
  else if (!canManageOpenShift(u, s)) throw forbidden('You cannot manage this open shift');
  return s;
}

type ShiftFields = { date: string; templateId?: string | null; startTime?: string; endTime?: string; breakMinutes?: number; title?: string; color?: string; locationId?: string | null };

/** Resolves template defaults + explicit fields into Shift columns (UTC instants from local times). */
async function resolveShift(u: UserCtx, tz: string, f: ShiftFields, employeeLocationId: string | null) {
  let tpl = null;
  if (f.templateId) {
    tpl = await prisma.shiftTemplate.findFirst({ where: { id: f.templateId, tenantId: u.tenantId } });
    if (!tpl) throw notFound('Shift template');
  }
  const startTime = f.startTime ?? tpl?.startTime;
  const endTime = f.endTime ?? tpl?.endTime;
  if (!startTime || !endTime) throw badRequest('startTime and endTime are required without a template', { fieldErrors: { startTime: ['Required'] }, formErrors: [] });
  if (startTime === endTime) throw badRequest('Shift cannot be empty', { fieldErrors: { endTime: ['Must differ from startTime'] }, formErrors: [] });
  await assertLocation(u.tenantId, f.locationId);
  const { startAt, endAt } = shiftInstants(f.date, startTime, endTime, tz);
  const breakMinutes = f.breakMinutes ?? tpl?.breakMinutes ?? 60;
  if (breakMinutes >= (endAt.getTime() - startAt.getTime()) / 60_000) throw badRequest('Break is longer than the shift', { fieldErrors: { breakMinutes: ['Too long'] }, formErrors: [] });
  return {
    templateId: tpl?.id ?? null,
    date: fromDateStr(f.date),
    startAt,
    endAt,
    breakMinutes,
    title: f.title ?? tpl?.name ?? `${startTime}–${endTime}`,
    color: f.color ?? tpl?.color ?? 'gray',
    locationId: f.locationId !== undefined ? f.locationId : (tpl?.locationId ?? employeeLocationId),
  };
}

async function assertNoOverlap(employeeId: string, date: string, exceptId?: string, tx: Tx = prisma) {
  const clash = await tx.shift.findFirst({ where: { employeeId, date: fromDateStr(date), ...(exceptId ? { id: { not: exceptId } } : {}) } });
  if (clash) throw conflict('Employee already has a shift on this day', { shiftId: clash.id });
}

export default async function planningRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // ── Shift templates ──
  app.get('/shift-templates', { schema: { querystring: z.object({ all: z.enum(['true', 'false']).optional() }) } }, async (req) => {
    const u = requireUser(req, 'time.self');
    const rows = await prisma.shiftTemplate.findMany({
      where: { tenantId: u.tenantId, ...(req.query.all === 'true' ? {} : { isActive: true }) },
      include: templateInclude,
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
    return rows.map(templateView);
  });

  app.post('/shift-templates', { schema: { body: ShiftTemplateInput } }, async (req, reply) => {
    const u = requireUser(req, 'time.manage');
    await assertLocation(u.tenantId, req.body.locationId);
    if (req.body.startTime === req.body.endTime) throw badRequest('Shift cannot be empty', { fieldErrors: { endTime: ['Must differ from startTime'] }, formErrors: [] });
    const t = await prisma.shiftTemplate.create({ data: { ...req.body, locationId: req.body.locationId ?? null, tenantId: u.tenantId }, include: templateInclude });
    await audit(u, 'time.template_create', 'ShiftTemplate', t.id, { name: t.name }, { ip: req.ip });
    return reply.status(201).send(templateView(t));
  });

  app.patch('/shift-templates/:id', { schema: { params: idParam, body: ShiftTemplateUpdate } }, async (req) => {
    const u = requireUser(req, 'time.manage');
    const found = await prisma.shiftTemplate.findFirst({ where: { id: req.params.id, tenantId: u.tenantId } });
    if (!found) throw notFound('Shift template');
    await assertLocation(u.tenantId, req.body.locationId);
    const t = await prisma.shiftTemplate.update({ where: { id: found.id }, data: req.body, include: templateInclude });
    await audit(u, 'time.template_update', 'ShiftTemplate', t.id, req.body, { ip: req.ip });
    return templateView(t);
  });

  app.delete('/shift-templates/:id', { schema: { params: idParam } }, async (req, reply) => {
    const u = requireUser(req, 'time.manage');
    const found = await prisma.shiftTemplate.findFirst({ where: { id: req.params.id, tenantId: u.tenantId } });
    if (!found) throw notFound('Shift template');
    await prisma.shiftTemplate.update({ where: { id: found.id }, data: { isActive: false } });
    await audit(u, 'time.template_deactivate', 'ShiftTemplate', found.id, { name: found.name }, { ip: req.ip });
    return reply.status(204).send();
  });

  // ── Schedule ──
  app.get('/schedule', { schema: { querystring: ScheduleQuery } }, async (req): Promise<ScheduleView> => {
    const u = requireUser(req, 'time.self');
    const { from, to, scope } = req.query;
    assertRange(from, to, 62);
    let where: Prisma.EmployeeWhereInput;
    if (scope === 'managed') {
      if (!u.permissions.includes('time.manage')) throw forbidden();
      where = await managedWhere(u, { status: 'ACTIVE', ...employeeFilter(req.query) });
    } else {
      const me = u.employeeId ? await prisma.employee.findUnique({ where: { id: u.employeeId }, select: { id: true, departmentId: true } }) : null;
      where = me
        ? { tenantId: u.tenantId, status: 'ACTIVE', ...(me.departmentId ? { departmentId: me.departmentId } : { id: me.id }), ...employeeFilter({ q: req.query.q }) }
        : { id: '__none__' };
    }
    const employees = await prisma.employee.findMany({ where, include: empRefInclude, orderBy: [{ user: { lastName: 'asc' } }, { user: { firstName: 'asc' } }] });
    const ids = employees.map((e) => e.id);
    const publishedOnly = scope !== 'managed';
    const range = { gte: fromDateStr(from), lte: fromDateStr(to) };
    const [shifts, absences, holidays, open] = await Promise.all([
      prisma.shift.findMany({ where: { tenantId: u.tenantId, employeeId: { in: ids }, date: range, ...(publishedOnly ? { status: 'PUBLISHED' as const } : {}) }, include: shiftInclude, orderBy: { startAt: 'asc' } }),
      prisma.absence.findMany({ where: { tenantId: u.tenantId, employeeId: { in: ids }, startDate: { lte: fromDateStr(to) }, endDate: { gte: fromDateStr(from) } }, orderBy: { startDate: 'asc' } }),
      holidaysInRange(from, to),
      prisma.shift.findMany({
        where: {
          tenantId: u.tenantId, employeeId: null, date: range,
          ...(publishedOnly || isHrOrAdmin(u) ? (publishedOnly ? { status: 'PUBLISHED' as const } : {}) : { OR: [{ status: 'PUBLISHED' as const }, { createdById: u.userId }] }),
        },
        include: shiftInclude,
        orderBy: { startAt: 'asc' },
      }),
    ]);
    const target = normHoursFor(from, to, buildCalendar(holidays));
    const rows = employees.map((e) => {
      const mine = shifts.filter((s) => s.employeeId === e.id);
      return {
        employee: empRef(e),
        plannedHours: hours1(mine.reduce((sum, s) => sum + plannedMinutesOf(s), 0)),
        targetHours: target,
        shifts: mine.map(shiftView),
        absences: absences.filter((a) => a.employeeId === e.id).map(absenceView),
      };
    });
    return {
      from, to, rows, openShifts: open.map(shiftView),
      holidays: holidays.map((h) => ({ date: h.date, name: h.name, kind: h.kind })),
      hasDrafts: shifts.some((s) => s.status === 'DRAFT') || open.some((s) => s.status === 'DRAFT'),
    };
  });

  // ── Shifts ──
  app.post('/shifts', { schema: { body: ShiftInput } }, async (req, reply) => {
    const u = requireUser(req, 'time.manage');
    const tz = await tenantTimezone(u.tenantId);
    const { employeeId, ...fields } = req.body;
    let empLoc: string | null = null;
    if (employeeId) {
      const e = await assertManaged(u, employeeId);
      if (e.status !== 'ACTIVE') throw businessRule('EMPLOYEE_INACTIVE', 'Employee is not active');
      empLoc = e.locationId;
      await assertNoOverlap(employeeId, fields.date);
    }
    const data = await resolveShift(u, tz, fields, empLoc);
    const s = await prisma.shift.create({ data: { ...data, tenantId: u.tenantId, employeeId, status: 'DRAFT', createdById: u.userId }, include: shiftInclude });
    await audit(u, 'time.shift_create', 'Shift', s.id, { employeeId, date: fields.date }, { ip: req.ip });
    return reply.status(201).send(shiftView(s));
  });

  app.patch('/shifts/:id', { schema: { params: idParam, body: ShiftUpdate } }, async (req) => {
    const u = requireUser(req, 'time.manage');
    const tz = await tenantTimezone(u.tenantId);
    const cur = await loadManagedShift(u, req.params.id);
    const b = req.body;
    const employeeId = b.employeeId !== undefined ? b.employeeId : cur.employeeId;
    let empLoc: string | null = null;
    if (employeeId) {
      const e = await assertManaged(u, employeeId);
      empLoc = e.locationId;
    }
    const date = b.date ?? dateStrOf(cur.date);
    if (employeeId) await assertNoOverlap(employeeId, date, cur.id);
    const templateId = b.templateId !== undefined ? b.templateId : cur.templateId;
    // Explicit times win; otherwise keep the current wall-clock times unless the template changed.
    const keepTimes = b.templateId === undefined || b.templateId === cur.templateId;
    const curTimes: { startTime?: string; endTime?: string } = keepTimes ? currentTimes(cur, tz) : {};
    const data = await resolveShift(
      u, tz,
      {
        date, templateId, startTime: b.startTime ?? curTimes.startTime, endTime: b.endTime ?? curTimes.endTime,
        breakMinutes: b.breakMinutes ?? (keepTimes ? cur.breakMinutes : undefined), title: b.title ?? (keepTimes ? cur.title : undefined),
        color: b.color ?? (keepTimes ? cur.color : undefined), locationId: b.locationId !== undefined ? b.locationId : cur.locationId,
      },
      empLoc,
    );
    // Any change goes back to draft until the manager publishes again.
    const s = await prisma.shift.update({ where: { id: cur.id }, data: { ...data, employeeId, status: 'DRAFT' }, include: shiftInclude });
    await audit(u, 'time.shift_update', 'Shift', s.id, b, { ip: req.ip });
    return shiftView(s);
  });

  app.delete('/shifts/:id', { schema: { params: idParam } }, async (req, reply) => {
    const u = requireUser(req, 'time.manage');
    const s = await loadManagedShift(u, req.params.id);
    await prisma.shift.delete({ where: { id: s.id } });
    await audit(u, 'time.shift_delete', 'Shift', s.id, { employeeId: s.employeeId, date: dateStrOf(s.date) }, { ip: req.ip });
    if (s.employeeId && s.status === 'PUBLISHED') {
      const e = await prisma.employee.findUnique({ where: { id: s.employeeId }, select: { userId: true } });
      if (e) await notify({ tenantId: u.tenantId, userId: e.userId, type: 'time.shift_removed', title: `Смена ${dateStrOf(s.date)} отменена`, body: s.title, link: '/my-time/schedule', email: false });
    }
    return reply.status(204).send();
  });

  // ── Pattern generation ──
  app.post('/shifts/pattern', { schema: { body: ShiftPatternInput } }, async (req, reply) => {
    const u = requireUser(req, 'time.manage');
    const b = req.body;
    assertRange(b.from, b.to);
    if (b.pattern === 'custom' && !b.cycle?.length) throw badRequest('cycle is required for a custom pattern', { fieldErrors: { cycle: ['Required'] }, formErrors: [] });
    const ids = await assertManagedMany(u, b.employeeIds);
    const tpl = await prisma.shiftTemplate.findFirst({ where: { id: b.templateId, tenantId: u.tenantId } });
    if (!tpl) throw notFound('Shift template');
    if (!tpl.isActive) throw businessRule('TEMPLATE_INACTIVE', 'Shift template is deactivated');
    const tz = await tenantTimezone(u.tenantId);
    const cal = buildCalendar(await holidaysInRange(b.from, b.to));
    const range = { gte: fromDateStr(b.from), lte: fromDateStr(b.to) };
    const employees = await prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, locationId: true, status: true } });
    let created = 0, skipped = 0;
    await prisma.$transaction(async (tx) => {
      if (b.replace) await tx.shift.deleteMany({ where: { tenantId: u.tenantId, employeeId: { in: ids }, date: range, status: 'DRAFT' } });
      const [existing, absences] = await Promise.all([
        tx.shift.findMany({ where: { tenantId: u.tenantId, employeeId: { in: ids }, date: range }, select: { employeeId: true, date: true } }),
        tx.absence.findMany({ where: { tenantId: u.tenantId, employeeId: { in: ids }, startDate: { lte: fromDateStr(b.to) }, endDate: { gte: fromDateStr(b.from) } } }),
      ]);
      const taken = new Set(existing.map((s) => `${s.employeeId}|${dateStrOf(s.date)}`));
      const rows: Prisma.ShiftCreateManyInput[] = [];
      for (const e of employees) {
        if (e.status !== 'ACTIVE') continue;
        datesInRange(b.from, b.to).forEach((d, i) => {
          let works = patternWorks(b.pattern, d, i + b.startOffset, b.cycle);
          // 5/2 follows the production calendar's transferred working Saturdays.
          if (b.pattern === '5/2' && b.skipHolidays && cal.get(d)?.kind === 'TRANSFER_WORKDAY') works = true;
          if (!works) return;
          if (b.skipHolidays && (isPublicHoliday(d, cal) || (b.pattern === '5/2' && !isWorkingDay(d, cal)))) return void skipped++;
          if (taken.has(`${e.id}|${d}`)) return void skipped++;
          if (absences.some((a) => a.employeeId === e.id && dateStrOf(a.startDate) <= d && dateStrOf(a.endDate) >= d)) return void skipped++;
          const { startAt, endAt } = shiftInstants(d, tpl.startTime, tpl.endTime, tz);
          rows.push({
            tenantId: u.tenantId, templateId: tpl.id, employeeId: e.id, date: fromDateStr(d), startAt, endAt, breakMinutes: tpl.breakMinutes,
            title: tpl.name, color: tpl.color, status: 'DRAFT', locationId: tpl.locationId ?? e.locationId, createdById: u.userId,
          });
        });
      }
      if (rows.length) created = (await tx.shift.createMany({ data: rows })).count;
    });
    await audit(u, 'time.shift_pattern', 'Shift', null, { pattern: b.pattern, from: b.from, to: b.to, employees: ids.length, created, skipped }, { ip: req.ip });
    return reply.status(201).send({ created, skipped });
  });

  // ── Copy week ──
  app.post('/shifts/copy-week', { schema: { body: CopyWeekInput } }, async (req, reply) => {
    const u = requireUser(req, 'time.manage');
    const b = req.body;
    if (b.fromWeekStart === b.toWeekStart) throw badRequest('Source and target weeks are the same');
    const delta = diffDays(b.fromWeekStart, b.toWeekStart);
    const scopeWhere = b.employeeIds?.length ? { id: { in: await assertManagedMany(u, b.employeeIds) } } : await managedWhere(u, { status: 'ACTIVE' });
    const ids = (await prisma.employee.findMany({ where: { AND: [scopeWhere, { status: 'ACTIVE' }] }, select: { id: true } })).map((e) => e.id);
    const tz = await tenantTimezone(u.tenantId);
    const srcRange = { gte: fromDateStr(b.fromWeekStart), lte: fromDateStr(addDaysStr(b.fromWeekStart, 6)) };
    const dstFrom = b.toWeekStart;
    const dstTo = addDaysStr(b.toWeekStart, 6);
    const [src, openSrc, existing, absences] = await Promise.all([
      prisma.shift.findMany({ where: { tenantId: u.tenantId, employeeId: { in: ids }, date: srcRange } }),
      b.employeeIds?.length ? Promise.resolve([]) : prisma.shift.findMany({ where: { tenantId: u.tenantId, employeeId: null, date: srcRange, ...(isHrOrAdmin(u) ? {} : { createdById: u.userId }) } }),
      prisma.shift.findMany({ where: { tenantId: u.tenantId, employeeId: { in: ids }, date: { gte: fromDateStr(dstFrom), lte: fromDateStr(dstTo) } }, select: { employeeId: true, date: true } }),
      prisma.absence.findMany({ where: { tenantId: u.tenantId, employeeId: { in: ids }, startDate: { lte: fromDateStr(dstTo) }, endDate: { gte: fromDateStr(dstFrom) } } }),
    ]);
    const taken = new Set(existing.map((s) => `${s.employeeId}|${dateStrOf(s.date)}`));
    const rows: Prisma.ShiftCreateManyInput[] = [];
    for (const s of [...src, ...openSrc]) {
      const d = addDaysStr(dateStrOf(s.date), delta);
      if (s.employeeId) {
        if (taken.has(`${s.employeeId}|${d}`)) continue;
        if (absences.some((a) => a.employeeId === s.employeeId && dateStrOf(a.startDate) <= d && dateStrOf(a.endDate) >= d)) continue;
        taken.add(`${s.employeeId}|${d}`);
      }
      // Keep the wall-clock times of the source shift.
      const t = currentTimes(s, tz);
      const { startAt, endAt } = shiftInstants(d, t.startTime, t.endTime, tz);
      rows.push({
        tenantId: u.tenantId, templateId: s.templateId, employeeId: s.employeeId, date: fromDateStr(d), startAt, endAt, breakMinutes: s.breakMinutes,
        title: s.title, color: s.color, status: 'DRAFT', locationId: s.locationId, createdById: u.userId,
      });
    }
    const created = rows.length ? (await prisma.shift.createMany({ data: rows })).count : 0;
    await audit(u, 'time.shift_copy_week', 'Shift', null, { from: b.fromWeekStart, to: b.toWeekStart, created }, { ip: req.ip });
    return reply.status(201).send({ created });
  });

  // ── Publish ──
  app.post('/shifts/publish', { schema: { body: PublishShiftsInput } }, async (req) => {
    const u = requireUser(req, 'time.manage');
    const b = req.body;
    assertRange(b.from, b.to);
    const range = { gte: fromDateStr(b.from), lte: fromDateStr(b.to) };
    const empWhere = b.employeeIds?.length ? { id: { in: await assertManagedMany(u, b.employeeIds) } } : await managedWhere(u);
    const ids = (await prisma.employee.findMany({ where: empWhere, select: { id: true } })).map((e) => e.id);
    const drafts = await prisma.shift.findMany({
      where: {
        tenantId: u.tenantId, status: 'DRAFT', date: range,
        OR: [{ employeeId: { in: ids } }, ...(b.employeeIds?.length ? [] : [{ employeeId: null, ...(isHrOrAdmin(u) ? {} : { createdById: u.userId }) }])],
      },
      select: { id: true, employeeId: true },
    });
    if (!drafts.length) return { published: 0 };
    await prisma.shift.updateMany({ where: { id: { in: drafts.map((d) => d.id) } }, data: { status: 'PUBLISHED' } });
    const affected = [...new Set(drafts.map((d) => d.employeeId).filter((x): x is string => !!x))];
    const users = await prisma.employee.findMany({ where: { id: { in: affected } }, select: { userId: true } });
    for (const e of users) {
      await notify({
        tenantId: u.tenantId, userId: e.userId, type: 'time.schedule_published', title: 'Опубликован график смен',
        body: `Период ${b.from} — ${b.to}`, link: '/my-time/schedule', email: false,
      });
    }
    await audit(u, 'time.shift_publish', 'Shift', null, { from: b.from, to: b.to, published: drafts.length }, { ip: req.ip });
    return { published: drafts.length };
  });

  // ── Open shifts ──
  app.post('/shifts/:id/claim', { schema: { params: idParam } }, async (req, reply) => {
    const u = requireUser(req, 'time.self');
    if (!u.employeeId) throw forbidden('Only employees can claim shifts');
    const tz = await tenantTimezone(u.tenantId);
    const s = await prisma.shift.findFirst({ where: { id: req.params.id, tenantId: u.tenantId, employeeId: null, status: 'PUBLISHED' } });
    if (!s) throw notFound('Open shift');
    if (dateStrOf(s.date) < todayLocal(tz)) throw businessRule('SHIFT_IN_PAST', 'This shift is already over');
    if (await prisma.shift.findFirst({ where: { employeeId: u.employeeId, date: s.date } })) throw businessRule('ALREADY_SCHEDULED', 'You already have a shift on this day');
    await prisma.openShiftClaim.create({ data: { shiftId: s.id, employeeId: u.employeeId } });
    const owner = await prisma.user.findFirst({ where: { id: s.createdById, tenantId: u.tenantId } });
    const me = await prisma.employee.findUniqueOrThrow({ where: { id: u.employeeId }, include: empRefInclude });
    const notifyIds = new Set<string>(owner ? [owner.id] : []);
    if (me.managerId) {
      const mgr = await prisma.employee.findUnique({ where: { id: me.managerId }, select: { userId: true } });
      if (mgr) notifyIds.add(mgr.userId);
    }
    for (const userId of notifyIds) {
      await notify({ tenantId: u.tenantId, userId, type: 'time.shift_claimed', title: `${empRef(me).shortName} записался на открытую смену`, body: `${s.title}, ${dateStrOf(s.date)}`, link: '/scheduling', email: false });
    }
    const full = await prisma.shift.findUniqueOrThrow({ where: { id: s.id }, include: shiftInclude });
    return reply.status(201).send(shiftView(full));
  });

  app.post('/shifts/:id/claims/:claimId/decide', { schema: { params: z.object({ id, claimId: id }), body: ClaimDecisionInput } }, async (req) => {
    const u = requireUser(req, 'time.manage');
    const s = await prisma.shift.findFirst({ where: { id: req.params.id, tenantId: u.tenantId }, include: { claims: true } });
    if (!s) throw notFound('Shift');
    const claim = s.claims.find((c) => c.id === req.params.claimId);
    if (!claim) throw notFound('Claim');
    await assertManaged(u, claim.employeeId);
    if (claim.status !== 'PENDING') throw conflict('Claim is already decided');
    const approve = req.body.decision === 'APPROVE';
    await prisma.$transaction(async (tx) => {
      if (approve) {
        if (s.employeeId) throw conflict('Shift is already assigned');
        if (await tx.shift.findFirst({ where: { employeeId: claim.employeeId, date: s.date } })) throw businessRule('ALREADY_SCHEDULED', 'Employee already has a shift on this day');
        await tx.shift.update({ where: { id: s.id }, data: { employeeId: claim.employeeId } });
        await tx.openShiftClaim.update({ where: { id: claim.id }, data: { status: 'APPROVED' } });
        await tx.openShiftClaim.updateMany({ where: { shiftId: s.id, id: { not: claim.id }, status: 'PENDING' }, data: { status: 'REJECTED' } });
      } else {
        await tx.openShiftClaim.update({ where: { id: claim.id }, data: { status: 'REJECTED' } });
      }
    });
    const emp = await prisma.employee.findUniqueOrThrow({ where: { id: claim.employeeId }, select: { userId: true } });
    await notify({
      tenantId: u.tenantId, userId: emp.userId, type: approve ? 'time.claim_approved' : 'time.claim_rejected',
      title: approve ? 'Вас назначили на открытую смену' : 'Запись на смену отклонена', body: `${s.title}, ${dateStrOf(s.date)}`, link: '/my-time', email: false,
    });
    await audit(u, 'time.claim_decide', 'Shift', s.id, { claimId: claim.id, decision: req.body.decision }, { ip: req.ip });
    return shiftView(await prisma.shift.findUniqueOrThrow({ where: { id: s.id }, include: shiftInclude }));
  });
}

/** Wall-clock "HH:MM" bounds of an existing shift in the tenant timezone. */
function currentTimes(s: { startAt: Date; endAt: Date }, tz: string) {
  return { startTime: localTimeStr(s.startAt, tz), endTime: localTimeStr(s.endAt, tz) };
}
