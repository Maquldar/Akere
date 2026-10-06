import type { Prisma } from '@prisma/client';
import type { AbsenceKind, MyDay, T13Sheet, TodayBoard } from '@akere/shared';
import { prisma, type Tx } from '../../lib/db';
import type { UserCtx } from '../../lib/auth';
import { forbidden, notFound } from '../../lib/errors';
import { isHrOrAdmin, managedEmployeeScope, managerSubtree } from '../../lib/scope';
import {
  addDaysStr, dateStrOf, datesInRange, isPublicHoliday, isWeekend, isWorkingDay, loadCalendar, localToUtc, monthBounds, normHoursFor,
  tenantTimeSettings, todayLocal, weekdayOf, type Calendar, type TimeSettings,
} from '../../lib/calendar';
import { fromDateStr } from '../../lib/dates';
import { boardSegments, groupMarksByDay, hours1, round1, summarizeDay, t13Cell, type DaySummary } from './compute';
import {
  absenceView, empRef, empRefInclude, markInclude, markView, requestInclude, requestView, shiftInclude, shiftView, type MarkRow, type ShiftRow,
} from './views';
import { toUserRef, userRefSelect, type UserRef } from '../../lib/names';

// ───────────── Scope helpers ─────────────

/** Employee rows the user manages for time tracking (manager subtree; HR/admin per legal entity). */
export async function managedWhere(u: UserCtx, extra: Prisma.EmployeeWhereInput = {}): Promise<Prisma.EmployeeWhereInput> {
  return { AND: [await managedEmployeeScope(u), extra] };
}

/** Throws 404 for unknown/other-tenant employees and 403 for employees outside the managed scope. */
export async function assertManaged(u: UserCtx, employeeId: string, tx: Tx = prisma) {
  const e = await tx.employee.findFirst({ where: { id: employeeId, tenantId: u.tenantId } });
  if (!e) throw notFound('Employee');
  if (!(await tx.employee.count({ where: { AND: [await managedEmployeeScope(u), { id: employeeId }] } }))) throw forbidden('Employee is outside your team');
  return e;
}

export async function assertManagedMany(u: UserCtx, employeeIds: string[]) {
  const ids = [...new Set(employeeIds)];
  const found = await prisma.employee.count({ where: { id: { in: ids }, tenantId: u.tenantId } });
  if (found !== ids.length) throw notFound('Employee');
  const managed = await prisma.employee.count({ where: { AND: [await managedEmployeeScope(u), { id: { in: ids } }] } });
  if (managed !== ids.length) throw forbidden('Some employees are outside your team');
  return ids;
}

/** Open shifts (no employee) are managed by HR/admin and by the manager who created them. */
export const canManageOpenShift = (u: UserCtx, s: { createdById: string }) => isHrOrAdmin(u) || s.createdById === u.userId;

export async function deciderRefs(ids: (string | null)[]): Promise<Map<string, UserRef>> {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: list } }, select: userRefSelect });
  return new Map(users.map((x) => [x.id, toUserRef(x)]));
}

// ───────────── Data loading ─────────────

const SPILL_MS = 14 * 3_600_000; // marks of a night shift after local midnight of the last day

export type DayData = Awaited<ReturnType<typeof loadDays>>;

/** Shifts, marks, absences and the production calendar for employees over a local date range. */
export async function loadDays(opts: { tenantId: string; employeeIds: string[]; from: string; to: string; tz: string; publishedOnly: boolean }) {
  const { tenantId, employeeIds, from, to, tz } = opts;
  const [shifts, marks, absences, cal] = await Promise.all([
    prisma.shift.findMany({
      where: { tenantId, employeeId: { in: employeeIds }, date: { gte: fromDateStr(from), lte: fromDateStr(to) }, ...(opts.publishedOnly ? { status: 'PUBLISHED' as const } : {}) },
      include: shiftInclude,
      orderBy: { startAt: 'asc' },
    }),
    prisma.timeMark.findMany({
      where: {
        tenantId, employeeId: { in: employeeIds },
        at: { gte: localToUtc(from, '00:00', tz), lt: new Date(localToUtc(addDaysStr(to, 1), '00:00', tz).getTime() + SPILL_MS) },
      },
      include: markInclude,
      orderBy: { at: 'asc' },
    }),
    prisma.absence.findMany({ where: { tenantId, employeeId: { in: employeeIds }, startDate: { lte: fromDateStr(to) }, endDate: { gte: fromDateStr(from) } }, orderBy: { startDate: 'asc' } }),
    loadCalendar(from, to),
  ]);
  const shiftMap = new Map<string, ShiftRow[]>();
  for (const s of shifts) {
    const k = `${s.employeeId}|${dateStrOf(s.date)}`;
    (shiftMap.get(k) ?? shiftMap.set(k, []).get(k)!).push(s);
  }
  const markMap = new Map<string, Map<string, MarkRow[]>>();
  const byEmp = new Map<string, MarkRow[]>();
  for (const m of marks) (byEmp.get(m.employeeId) ?? byEmp.set(m.employeeId, []).get(m.employeeId)!).push(m);
  for (const [emp, list] of byEmp) markMap.set(emp, groupMarksByDay(list, tz));
  return {
    cal,
    shifts,
    absences,
    shiftOf: (emp: string, date: string) => shiftMap.get(`${emp}|${date}`)?.[0] ?? null,
    shiftsOf: (emp: string, date: string) => shiftMap.get(`${emp}|${date}`) ?? [],
    marksOf: (emp: string, date: string) => markMap.get(emp)?.get(date) ?? [],
    absenceOf: (emp: string, date: string) => absences.find((a) => a.employeeId === emp && dateStrOf(a.startDate) <= date && dateStrOf(a.endDate) >= date) ?? null,
  };
}

export function summarize(data: DayData, emp: string, date: string, ctx: { today: string; now: Date; tz: string }): DaySummary {
  const shift = data.shiftOf(emp, date);
  return summarizeDay({
    date, today: ctx.today, now: ctx.now, tz: ctx.tz, shift, marks: data.marksOf(emp, date),
    absenceKind: (data.absenceOf(emp, date)?.kind as AbsenceKind | undefined) ?? null, publicHoliday: isPublicHoliday(date, data.cal),
  });
}

// ───────────── My day / week ─────────────

export async function locationView(locationId: string | null | undefined) {
  if (!locationId) return null;
  return prisma.workLocation.findUnique({ where: { id: locationId }, select: { id: true, name: true, address: true, lat: true, lng: true, radiusM: true } });
}

/** The published shift that applies "now": a running night shift from yesterday wins over today's. */
export function currentShift(data: DayData, emp: string, today: string, now: Date) {
  const y = data.shiftOf(emp, addDaysStr(today, -1));
  if (y && y.endAt > now && y.startAt <= now) return { date: addDaysStr(today, -1), shift: y };
  return { date: today, shift: data.shiftOf(emp, today) };
}

export async function buildMyDay(u: UserCtx, employeeId: string, settings?: TimeSettings, now = new Date()): Promise<MyDay> {
  const s = settings ?? (await tenantTimeSettings(u.tenantId));
  const tz = s.timezone;
  const today = todayLocal(tz, now);
  const data = await loadDays({ tenantId: u.tenantId, employeeIds: [employeeId], from: addDaysStr(today, -1), to: addDaysStr(today, 7), tz, publishedOnly: true });
  const cur = currentShift(data, employeeId, today, now);
  const day = cur.date;
  const sum = summarize(data, employeeId, day, { today: day, now, tz });
  const shift = cur.shift;
  const emp = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { locationId: true } });
  const [location, requests, openShifts] = await Promise.all([
    locationView(shift?.locationId ?? emp.locationId),
    prisma.timeRequest.findMany({ where: { tenantId: u.tenantId, employeeId }, include: requestInclude, orderBy: { createdAt: 'desc' }, take: 10 }),
    prisma.shift.findMany({
      where: { tenantId: u.tenantId, employeeId: null, status: 'PUBLISHED', date: { gte: fromDateStr(today) } },
      include: shiftInclude, orderBy: { startAt: 'asc' }, take: 10,
    }),
  ]);
  const deciders = await deciderRefs(requests.map((r) => r.decidedById));
  const remaining =
    shift && ['NOT_STARTED', 'ON_SHIFT', 'ON_BREAK'].includes(sum.dayStatus) ? Math.max(0, Math.round((shift.endAt.getTime() - now.getTime()) / 60_000)) : null;
  const upcoming = datesInRange(addDaysStr(today, 1), addDaysStr(today, 7)).map((d) => {
    const sh = data.shiftOf(employeeId, d);
    const ab = data.absenceOf(employeeId, d);
    return { date: d, shift: sh ? shiftView(sh) : null, absence: ab ? absenceView(ab) : null, holiday: data.cal.get(d)?.kind !== 'TRANSFER_WORKDAY' ? (data.cal.get(d)?.name ?? null) : null };
  });
  return {
    date: day,
    shift: shift ? shiftView(shift) : null,
    status: sum.dayStatus,
    lateMinutes: sum.lateMinutes,
    earlyLeaveMinutes: sum.earlyLeaveMinutes,
    workedMinutes: sum.workedMinutes,
    breakMinutes: sum.breakMinutes,
    marks: data.marksOf(employeeId, day).map(markView),
    remainingMinutes: remaining,
    settings: { requireSelfie: s.requireSelfie, requireGeofence: s.requireGeofence, location },
    upcoming,
    requests: requests.map((r) => requestView(r, deciders)),
    openShifts: openShifts.map(shiftView),
  };
}

// ───────────── Board ─────────────

export async function buildBoard(u: UserCtx, q: { date?: string; departmentId?: string; q?: string; status?: string }, now = new Date()): Promise<TodayBoard> {
  const { timezone: tz } = await tenantTimeSettings(u.tenantId);
  const today = todayLocal(tz, now);
  const date = q.date ?? today;
  const employees = await prisma.employee.findMany({
    where: await managedWhere(u, { status: 'ACTIVE', ...employeeFilter(q) }),
    include: empRefInclude,
    orderBy: [{ user: { lastName: 'asc' } }, { user: { firstName: 'asc' } }],
  });
  const data = await loadDays({ tenantId: u.tenantId, employeeIds: employees.map((e) => e.id), from: date, to: date, tz, publishedOnly: true });
  const kpi = { onShiftNow: 0, scheduledToday: 0, needAttention: 0, noMarks: 0, overtimeMinutes: 0, closedShifts: 0, totalShifts: 0, factMinutes: 0, deltaToPlanMinutes: 0 };
  const rows: TodayBoard['rows'] = [];
  for (const e of employees) {
    const shift = data.shiftOf(e.id, date);
    const marks = data.marksOf(e.id, date);
    const absence = data.absenceOf(e.id, date);
    if (!shift && !marks.length && !absence) continue;
    const s = summarize(data, e.id, date, { today, now, tz });
    if (shift && s.boardStatus !== 'ABSENT') {
      kpi.scheduledToday++;
      kpi.totalShifts++;
    }
    if (s.open && date === today && s.dayStatus !== 'NO_OUT') kpi.onShiftNow++;
    if (['NO_MARKS', 'NO_OUT', 'LATE', 'UNDERWORK'].includes(s.boardStatus)) kpi.needAttention++;
    if (s.boardStatus === 'NO_MARKS') kpi.noMarks++;
    kpi.overtimeMinutes += s.overtimeMinutes;
    if (shift && s.dayStatus === 'FINISHED') {
      kpi.closedShifts++;
      kpi.factMinutes += s.workedMinutes;
      kpi.deltaToPlanMinutes += s.workedMinutes - s.plannedMinutes;
    }
    rows.push({
      employee: empRef(e), shift: shift ? shiftView(shift) : null, status: s.boardStatus,
      inAt: s.inAt?.toISOString() ?? null, outAt: s.outAt?.toISOString() ?? null, segments: boardSegments(s, shift),
      workedMinutes: s.workedMinutes, plannedMinutes: s.plannedMinutes, deviationMinutes: s.deviationMinutes,
    });
  }
  return { date, kpi, rows: q.status ? rows.filter((r) => r.status === q.status) : rows };
}

export function employeeFilter(q: { departmentId?: string; legalEntityId?: string; q?: string }): Prisma.EmployeeWhereInput {
  const and: Prisma.EmployeeWhereInput[] = [];
  if (q.departmentId) and.push({ departmentId: q.departmentId });
  if (q.legalEntityId) and.push({ legalEntityId: q.legalEntityId });
  if (q.q) {
    for (const word of q.q.split(/\s+/).filter(Boolean).slice(0, 3)) {
      and.push({
        OR: [
          { user: { lastName: { contains: word, mode: 'insensitive' } } },
          { user: { firstName: { contains: word, mode: 'insensitive' } } },
          { tabNumber: { contains: word } },
          { position: { name: { contains: word, mode: 'insensitive' } } },
        ],
      });
    }
  }
  return and.length ? { AND: and } : {};
}

// ───────────── T-13 ─────────────

export type T13Data = T13Sheet & { meta: { tenantName: string; legalEntityName: string | null; departmentName: string | null }; rowsMeta: { tabNumber: string; position: string | null }[] };

export async function buildT13(u: UserCtx, q: { year: number; month: number; legalEntityId?: string; departmentId?: string; q?: string }, now = new Date()): Promise<T13Data> {
  const { timezone: tz } = await tenantTimeSettings(u.tenantId);
  const today = todayLocal(tz, now);
  const { from, to } = monthBounds(q.year, q.month);
  const manage = u.permissions.includes('time.manage');
  const base: Prisma.EmployeeWhereInput = {
    hireDate: { lte: fromDateStr(to) },
    OR: [{ status: 'ACTIVE' }, { terminationDate: { gte: fromDateStr(from) } }],
    ...employeeFilter(q),
  };
  const scope: Prisma.EmployeeWhereInput = manage ? await managedWhere(u, base) : { AND: [{ tenantId: u.tenantId, id: u.employeeId ?? '__none__' }, base] };
  const employees = await prisma.employee.findMany({
    where: scope, include: empRefInclude, orderBy: [{ user: { lastName: 'asc' } }, { user: { firstName: 'asc' } }],
  });
  const data = await loadDays({ tenantId: u.tenantId, employeeIds: employees.map((e) => e.id), from, to, tz, publishedOnly: true });
  const cal: Calendar = data.cal;
  const dates = datesInRange(from, to);
  const days = dates.map((d, i) => ({ day: i + 1, weekday: weekdayOf(d), isHoliday: isPublicHoliday(d, cal), isWeekend: !isWorkingDay(d, cal) }));
  const norm = normHoursFor(from, to, cal);
  const perDay = dates.map(() => 0);
  const totals = { planHours: 0, factHours: 0, normHours: 0, overtime15: 0, overtime2: 0, perDay };
  let deviationsTotal = 0;
  const rows: T13Sheet['rows'] = [];
  const rowsMeta: T13Data['rowsMeta'] = [];
  for (const e of employees) {
    let plan = 0, fact = 0, ot15 = 0, ot2 = 0, deviations = 0;
    const cells = dates.map((d, i) => {
      const s = summarize(data, e.id, d, { today, now, tz });
      const shift = data.shiftOf(e.id, d);
      const absence = data.absenceOf(e.id, d);
      const cell = t13Cell(s, {
        today, absenceKind: (absence?.kind as AbsenceKind | undefined) ?? null, hasShift: !!shift, publicHoliday: isPublicHoliday(d, cal),
        weekendOrOff: !shift || isWeekend(d),
      });
      plan += s.plannedMinutes;
      fact += s.workedMinutes;
      ot15 += s.overtime15Minutes;
      ot2 += s.overtime2Minutes;
      if (cell.deviation) deviations++;
      if (cell.hours) perDay[i] = round1(perDay[i]! + cell.hours);
      return { day: i + 1, ...cell };
    });
    const row = { employee: empRef(e), planHours: hours1(plan), factHours: hours1(fact), normHours: norm, overtime15: hours1(ot15), overtime2: hours1(ot2), deviations, cells };
    rows.push(row);
    rowsMeta.push({ tabNumber: e.tabNumber, position: e.position?.name ?? null });
    totals.planHours += row.planHours;
    totals.factHours += row.factHours;
    totals.normHours += norm;
    totals.overtime15 += row.overtime15;
    totals.overtime2 += row.overtime2;
    deviationsTotal += deviations;
  }
  totals.planHours = round1(totals.planHours);
  totals.factHours = round1(totals.factHours);
  totals.overtime15 = round1(totals.overtime15);
  totals.overtime2 = round1(totals.overtime2);

  // Confirmation: every manager who has direct reports among the rows confirms their part.
  const managerIds = [...new Set((await prisma.employee.findMany({ where: { id: { in: employees.map((e) => e.id) } }, select: { managerId: true } })).map((x) => x.managerId).filter((x): x is string => !!x))];
  const confirmations = managerIds.length
    ? await prisma.timesheetConfirmation.findMany({ where: { tenantId: u.tenantId, year: q.year, month: q.month, managerEmployeeId: { in: managerIds } } })
    : [];
  const mine = u.employeeId && managerIds.includes(u.employeeId) ? confirmations.some((c) => c.managerEmployeeId === u.employeeId) : null;

  const [tenant, le, dept] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: u.tenantId }, select: { name: true } }),
    q.legalEntityId ? prisma.legalEntity.findFirst({ where: { id: q.legalEntityId, tenantId: u.tenantId }, select: { name: true } }) : null,
    q.departmentId ? prisma.department.findFirst({ where: { id: q.departmentId, tenantId: u.tenantId }, select: { name: true } }) : null,
  ]);
  return {
    year: q.year, month: q.month, days, rows, totals, deviationsTotal,
    confirmation: { confirmed: confirmations.length, total: managerIds.length, mine },
    meta: { tenantName: tenant?.name ?? '', legalEntityName: le?.name ?? null, departmentName: dept?.name ?? null },
    rowsMeta,
  };
}

/** Pending time requests the user can decide (inbox counter). */
export async function pendingRequestsToDecide(u: UserCtx): Promise<number> {
  if (!u.permissions.includes('time.manage')) return 0;
  if (!isHrOrAdmin(u) && !(await managerSubtree(u)).length) return 0;
  return prisma.timeRequest.count({
    where: { tenantId: u.tenantId, status: 'PENDING', employee: await managedWhere(u, u.employeeId ? { id: { not: u.employeeId } } : {}) },
  });
}

