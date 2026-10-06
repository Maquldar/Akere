import type { Prisma } from '@prisma/client';
import { CANDIDATE_STATUSES, type Dashboard, type HeadcountReport, type MovementsReport } from '@akere/shared';
import { prisma } from '../../lib/db';
import type { UserCtx } from '../../lib/auth';
import { forbidden } from '../../lib/errors';
import { fromDateStr, toDateStr } from '../../lib/dates';
import { hrLegalEntityIds, isHrOrAdmin, legalEntityAllowed, managerSubtree } from '../../lib/scope';
import { tenantTimezone, todayLocal } from '../../lib/calendar';

/**
 * Analytics (F-35). Scope: HR/ADMIN — their legal entities (ADMIN/tenant-wide HR: all); MANAGER — their reporting subtree.
 * Employee counts use hire/termination dates, so any past date or period can be reported.
 */
export type ReportScope = {
  hr: boolean;
  emp: Prisma.EmployeeWhereInput;
  doc: Prisma.DocumentWhereInput;
  legalEntityIds: string[] | null;
  subtree: string[] | null;
};

export async function reportScope(u: UserCtx, legalEntityId?: string): Promise<ReportScope> {
  if (isHrOrAdmin(u)) {
    if (legalEntityId && !legalEntityAllowed(u, legalEntityId)) throw forbidden('The legal entity is outside your scope');
    const le = legalEntityId ? [legalEntityId] : hrLegalEntityIds(u);
    const leWhere = le === null ? {} : { legalEntityId: { in: le } };
    return { hr: true, emp: { tenantId: u.tenantId, ...leWhere }, doc: { tenantId: u.tenantId, ...leWhere }, legalEntityIds: le, subtree: null };
  }
  const subtree = await managerSubtree(u);
  const leWhere = legalEntityId ? { legalEntityId } : {};
  return {
    hr: false,
    emp: { tenantId: u.tenantId, id: { in: subtree }, ...leWhere },
    doc: { tenantId: u.tenantId, subjectEmployeeId: { in: subtree }, ...leWhere },
    legalEntityIds: legalEntityId ? [legalEntityId] : null,
    subtree,
  };
}

/** Employees on staff at the end of the given day. */
export const employedAt = (d: Date): Prisma.EmployeeWhereInput => ({
  hireDate: { lte: d },
  OR: [{ terminationDate: null, status: 'ACTIVE' }, { terminationDate: { gt: d } }],
});

export async function resolvePeriod(tenantId: string, q: { from?: string; to?: string }, defaultMonths = 1) {
  const today = todayLocal(await tenantTimezone(tenantId));
  const to = q.to ?? today;
  let from = q.from;
  if (!from) {
    const t = fromDateStr(to);
    from = toDateStr(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - (defaultMonths - 1), 1)));
  }
  if (from > to) from = to;
  return { from, to, today, fromD: fromDateStr(from), toD: fromDateStr(to), toEnd: new Date(fromDateStr(to).getTime() + 86_400_000) };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export async function buildDashboard(u: UserCtx, q: { legalEntityId?: string; from?: string; to?: string }): Promise<Dashboard> {
  const s = await reportScope(u, q.legalEntityId);
  const p = await resolvePeriod(u.tenantId, q);
  const now = new Date();
  const today = fromDateStr(p.today);
  const leDoc = s.legalEntityIds === null ? {} : { legalEntityId: { in: s.legalEntityIds } };

  const [headcount, headcountStart, hired, dismissed] = await Promise.all([
    prisma.employee.count({ where: { AND: [s.emp, employedAt(p.toD)] } }),
    prisma.employee.count({ where: { AND: [s.emp, employedAt(new Date(p.fromD.getTime() - 86_400_000))] } }),
    prisma.employee.count({ where: { AND: [s.emp, { hireDate: { gte: p.fromD, lte: p.toD } }] } }),
    prisma.employee.count({ where: { AND: [s.emp, { terminationDate: { gte: p.fromD, lte: p.toD } }] } }),
  ]);
  const avg = (headcount + headcountStart) / 2;
  const turnoverPct = avg > 0 ? round1((dismissed / avg) * 100) : 0;

  const candidates = Object.fromEntries(CANDIDATE_STATUSES.map((x) => [x, 0])) as Dashboard['candidates'];
  if (s.hr) {
    const groups = await prisma.candidate.groupBy({ by: ['status'], where: { tenantId: u.tenantId, ...leDoc }, _count: { _all: true } });
    for (const g of groups) candidates[g.status] = g._count._all;
  }

  const docBase: Prisma.DocumentWhereInput = { AND: [s.doc, { kind: { notIn: ['ARCHIVE', 'VND'] } }] };
  const overdueWhere: Prisma.DocumentWhereInput = { status: 'IN_ROUTE', OR: [{ dueAt: { lt: now } }, { steps: { some: { status: 'PENDING', dueAt: { lt: now } } } }] };
  const [inRoute, overdue, completedRows] = await Promise.all([
    prisma.document.count({ where: { AND: [docBase, { status: 'IN_ROUTE' }] } }),
    prisma.document.count({ where: { AND: [docBase, overdueWhere] } }),
    prisma.document.findMany({ where: { AND: [docBase, { status: 'COMPLETED', completedAt: { gte: p.fromD, lt: p.toEnd } }] }, select: { createdAt: true, completedAt: true } }),
  ]);
  const durations = completedRows.map((r) => (r.completedAt!.getTime() - r.createdAt.getTime()) / 3_600_000).filter((h) => h >= 0);
  const avgCompletionHours = durations.length ? round1(durations.reduce((a, b) => a + b, 0) / durations.length) : null;

  const reqScope: Prisma.RequestWhereInput = { tenantId: u.tenantId, employee: s.emp };
  const [reqPending, reqCompleted] = await Promise.all([
    prisma.request.count({ where: { ...reqScope, status: { in: ['IN_APPROVAL', 'REWORK', 'ORDER_SIGNING'] } } }),
    prisma.request.count({ where: { ...reqScope, status: 'COMPLETED', completedAt: { gte: p.fromD, lt: p.toEnd } } }),
  ]);

  // ВНД: HR — ВНД of their legal entities; manager — acknowledgments of their subtree.
  const vndDocs: Prisma.DocumentWhereInput = { tenantId: u.tenantId, kind: 'VND', ...leDoc };
  const vndInProgress = s.hr
    ? await prisma.document.count({ where: { ...vndDocs, status: 'IN_ROUTE' } })
    : await prisma.document.count({ where: { ...vndDocs, status: 'IN_ROUTE', vndRecipients: { some: { employee: s.emp } } } });
  const recWhere: Prisma.VndRecipientWhereInput = { document: { ...vndDocs, status: { in: ['IN_ROUTE', 'COMPLETED'] } }, ...(s.hr ? {} : { employee: s.emp }) };
  const [recTotal, recDone] = await Promise.all([
    prisma.vndRecipient.count({ where: recWhere }),
    prisma.vndRecipient.count({ where: { ...recWhere, status: 'ACKNOWLEDGED' } }),
  ]);

  let esutd = { notSent: 0, errors: 0 };
  if (s.hr) {
    const base: Prisma.EsutdSubmissionWhereInput = { tenantId: u.tenantId, document: { status: 'COMPLETED', ...leDoc } };
    const [ns, er] = await Promise.all([
      prisma.esutdSubmission.count({ where: { ...base, status: 'NOT_SENT' } }),
      prisma.esutdSubmission.count({ where: { ...base, status: 'ERROR' } }),
    ]);
    esutd = { notSent: ns, errors: er };
  }

  const absences = await prisma.absence.groupBy({
    by: ['kind'],
    where: { tenantId: u.tenantId, startDate: { lte: today }, endDate: { gte: today }, employee: s.emp },
    _count: { _all: true },
  });
  const abs = (k: string) => absences.find((a) => a.kind === k)?._count._all ?? 0;

  return {
    headcount, hiredInPeriod: hired, dismissedInPeriod: dismissed, turnoverPct, candidates,
    documents: { inRoute, overdue, completedInPeriod: completedRows.length, avgCompletionHours },
    requests: { pending: reqPending, completedInPeriod: reqCompleted },
    vnd: { inProgress: vndInProgress, completionPct: recTotal ? round1((recDone / recTotal) * 100) : 0 },
    esutd,
    absencesToday: { vacation: abs('VACATION'), sick: abs('SICK'), businessTrip: abs('BUSINESS_TRIP') },
  };
}

export async function buildHeadcount(u: UserCtx, q: { legalEntityId?: string; date?: string }): Promise<HeadcountReport & { date: string }> {
  const s = await reportScope(u, q.legalEntityId);
  const date = q.date ?? todayLocal(await tenantTimezone(u.tenantId));
  const where: Prisma.EmployeeWhereInput = { AND: [s.emp, employedAt(fromDateStr(date))] };
  const [byDept, byPos, total] = await Promise.all([
    prisma.employee.groupBy({ by: ['departmentId'], where, _count: { _all: true } }),
    prisma.employee.groupBy({ by: ['positionId'], where, _count: { _all: true } }),
    prisma.employee.count({ where }),
  ]);
  const deptIds = byDept.map((d) => d.departmentId).filter((x): x is string => !!x);
  const posIds = byPos.map((d) => d.positionId).filter((x): x is string => !!x);
  const [depts, positions] = await Promise.all([
    prisma.department.findMany({ where: { id: { in: deptIds } }, select: { id: true, name: true } }),
    prisma.position.findMany({ where: { id: { in: posIds } }, select: { id: true, name: true } }),
  ]);
  const dn = new Map(depts.map((d) => [d.id, d.name]));
  const pn = new Map(positions.map((d) => [d.id, d.name]));
  const sortRows = <T extends { count: number; name: string }>(a: T, b: T) => b.count - a.count || a.name.localeCompare(b.name, 'ru');
  return {
    date,
    byDepartment: byDept
      .map((d) => ({ department: { id: d.departmentId ?? '', name: d.departmentId ? (dn.get(d.departmentId) ?? '—') : 'Без подразделения' }, count: d._count._all }))
      .sort((a, b) => sortRows({ count: a.count, name: a.department.name }, { count: b.count, name: b.department.name })),
    byPosition: byPos
      .map((d) => ({ position: { id: d.positionId ?? '', name: d.positionId ? (pn.get(d.positionId) ?? '—') : 'Без должности' }, count: d._count._all }))
      .sort((a, b) => sortRows({ count: a.count, name: a.position.name }, { count: b.count, name: b.position.name })),
    total,
  };
}

const monthKey = (d: Date) => d.toISOString().slice(0, 7);

export async function buildMovements(u: UserCtx, q: { legalEntityId?: string; from?: string; to?: string }): Promise<MovementsReport & { from: string; to: string }> {
  const s = await reportScope(u, q.legalEntityId);
  const p = await resolvePeriod(u.tenantId, q, 12);
  const months: MovementsReport['months'] = [];
  for (let d = new Date(Date.UTC(p.fromD.getUTCFullYear(), p.fromD.getUTCMonth(), 1)); d <= p.toD; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    months.push({ month: monthKey(d), hired: 0, dismissed: 0, transferred: 0 });
  }
  const byMonth = new Map(months.map((m) => [m.month, m]));
  const [hired, dismissed, transfers] = await Promise.all([
    prisma.employee.findMany({ where: { AND: [s.emp, { hireDate: { gte: p.fromD, lte: p.toD } }] }, select: { hireDate: true } }),
    prisma.employee.findMany({ where: { AND: [s.emp, { terminationDate: { gte: p.fromD, lte: p.toD } }] }, select: { terminationDate: true } }),
    // Transfers: completed transfer orders; the month is the order's effective date (or its completion date).
    prisma.document.findMany({
      where: { AND: [s.doc, { status: 'COMPLETED', kind: { not: 'ARCHIVE' }, documentType: { code: 'TRANSFER_ORDER' } }] },
      select: { data: true, completedAt: true },
    }),
  ]);
  for (const e of hired) byMonth.get(monthKey(e.hireDate))!.hired++;
  for (const e of dismissed) byMonth.get(monthKey(e.terminationDate!))!.dismissed++;
  for (const t of transfers) {
    const eff = (t.data as Record<string, unknown>)?.effectiveDate;
    const at = typeof eff === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(eff) ? fromDateStr(eff) : t.completedAt;
    if (!at || at < p.fromD || at > p.toD) continue;
    const m = byMonth.get(monthKey(at));
    if (m) m.transferred++;
  }
  return { from: p.from, to: p.to, months };
}
