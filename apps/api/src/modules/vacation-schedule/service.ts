import type { Prisma, VacationCampaign } from '@prisma/client';
import type { BulkResult, PlanRow, VacationPlanInput } from '@akere/shared';
import { prisma, type Tx } from '../../lib/db';
import { can, hasRole, type UserCtx } from '../../lib/auth';
import { businessRule, conflict, forbidden, notFound } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { notify } from '../../lib/notify';
import { employeeScope, managedEmployeeScope } from '../../lib/scope';
import { toUserRef, userRefSelect } from '../../lib/names';
import { fromDateStr, optDateStr, toDateStr, todayUtc } from '../../lib/dates';
import { DEFAULT_TZ, addDaysStr, diffDays, todayLocal } from '../../lib/calendar';
import { getVacationBalance } from '../employees/service';
import { hrUsersFor } from '../documents/route-engine';
import { fmtShort, leaveDays } from '../requests/days';

const SCHEDULE_LINK = '/vacation-schedule';
export const MIN_MAIN_PART = 14;

// ───────────────────────── Campaigns ─────────────────────────

export async function findCampaign(u: UserCtx, id: string, tx: Tx = prisma) {
  const c = await tx.vacationCampaign.findFirst({ where: { id, tenantId: u.tenantId } });
  if (!c || (c.status === 'DRAFT' && !can(u, 'vacation.manage'))) throw notFound('Campaign');
  return c;
}

export async function campaignViews(u: UserCtx, campaigns: VacationCampaign[]) {
  const scope: Prisma.EmployeeWhereInput = { AND: [await employeeScope(u), { status: 'ACTIVE' }] };
  const employees = await prisma.employee.count({ where: scope });
  const out = [];
  for (const c of campaigns) {
    const counts = await prisma.vacationPlan.groupBy({ by: ['status'], where: { campaignId: c.id, employee: scope }, _count: { _all: true } });
    const n = (s: string) => counts.find((x) => x.status === s)?._count._all ?? 0;
    out.push({ id: c.id, year: c.year, status: c.status, deadline: optDateStr(c.deadline), totals: { employees, submitted: n('SUBMITTED'), approved: n('APPROVED') } });
  }
  return out;
}

/** In-app notice to every active employee of the tenant when planning opens. */
export async function notifyCampaignOpened(c: VacationCampaign, tx: Tx = prisma) {
  const users = await tx.employee.findMany({ where: { tenantId: c.tenantId, status: 'ACTIVE' }, select: { userId: true } });
  for (const e of users) {
    await notify({
      tenantId: c.tenantId, userId: e.userId, type: 'vacation.campaign_opened', email: false,
      title: `Открыто планирование графика отпусков на ${c.year} г.`,
      body: c.deadline ? `Запланируйте отпуск до ${fmtShort(toDateStr(c.deadline))}.` : 'Запланируйте даты отпуска.',
      link: SCHEDULE_LINK,
    }, tx);
  }
}

// ───────────────────────── Entitlement ─────────────────────────

/**
 * Days an employee may plan in a campaign year Y (API.md §9 "total ≤ entitlement + carry-over balance"):
 *  - future year (Y > current): available balance today (carry-over) + vacationDaysPerYear × (Y − current year)
 *  - current/past year: available balance projected to 31.12.Y (accrual through the year end, minus usage so far)
 * Rounded down to whole days, never negative.
 */
export async function entitlementFor(employeeId: string, year: number, tx: Tx = prisma): Promise<number> {
  const today = todayUtc();
  const current = today.getUTCFullYear();
  if (year > current) {
    const bal = await getVacationBalance(employeeId, tx, today);
    return Math.max(0, Math.floor(bal.available + bal.perYear * (year - current)));
  }
  const bal = await getVacationBalance(employeeId, tx, fromDateStr(`${year}-12-31`));
  return Math.max(0, Math.floor(bal.available));
}

// ───────────────────────── Plan rows ─────────────────────────

const employeeInclude = (campaignId: string) => ({
  user: { select: userRefSelect },
  vacationPlans: { where: { campaignId }, include: { periods: { orderBy: { startDate: 'asc' as const } } } },
}) satisfies Prisma.EmployeeInclude;
type EmpRow = Prisma.EmployeeGetPayload<{ include: ReturnType<typeof employeeInclude> }>;

/** Employees whose plans the user may approve (manager subtree / HR legal entities), never themselves. */
async function approvableIds(u: UserCtx, employeeIds: string[]): Promise<Set<string>> {
  if (!can(u, 'vacation.approve') || !employeeIds.length) return new Set();
  const rows = await prisma.employee.findMany({ where: { AND: [await managedEmployeeScope(u), { id: { in: employeeIds } }] }, select: { id: true } });
  return new Set(rows.map((r) => r.id).filter((x) => x !== u.employeeId || hasRole(u, 'ADMIN')));
}

async function toRows(u: UserCtx, campaign: VacationCampaign, emps: EmpRow[]): Promise<PlanRow[]> {
  const approvable = await approvableIds(u, emps.map((e) => e.id));
  const out: PlanRow[] = [];
  for (const e of emps) {
    const plan = e.vacationPlans[0] ?? null;
    const periods = (plan?.periods ?? []).map((p) => ({ id: p.id, startDate: toDateStr(p.startDate), endDate: toDateStr(p.endDate), days: p.days }));
    out.push({
      employee: { ...toUserRef(e.user), employeeId: e.id },
      status: plan?.status ?? 'NONE',
      entitlement: await entitlementFor(e.id, campaign.year),
      planned: periods.reduce((s, p) => s + p.days, 0),
      periods,
      comment: plan?.comment ?? null,
      canApprove: campaign.status === 'ACTIVE' && plan?.status === 'SUBMITTED' && approvable.has(e.id),
    });
  }
  return out;
}

export type GridQuery = { status?: string; employeeId?: string; departmentId?: string; positionId?: string; q?: string; page: number; pageSize: number };

export async function gridWhere(u: UserCtx, campaign: VacationCampaign, q: Omit<GridQuery, 'page' | 'pageSize'>): Promise<Prisma.EmployeeWhereInput> {
  const and: Prisma.EmployeeWhereInput[] = [await employeeScope(u), { status: 'ACTIVE' }];
  if (q.employeeId) and.push({ id: q.employeeId });
  if (q.departmentId) and.push({ departmentId: q.departmentId });
  if (q.positionId) and.push({ positionId: q.positionId });
  if (q.q) {
    const words = q.q.split(/\s+/).filter(Boolean).slice(0, 3);
    for (const w of words) {
      and.push({ OR: [{ user: { lastName: { contains: w, mode: 'insensitive' } } }, { user: { firstName: { contains: w, mode: 'insensitive' } } }, { tabNumber: { contains: w } }] });
    }
  }
  if (q.status === 'NONE') and.push({ vacationPlans: { none: { campaignId: campaign.id } } });
  else if (q.status) and.push({ vacationPlans: { some: { campaignId: campaign.id, status: q.status as 'DRAFT' } } });
  return { AND: and };
}

const nameOrder: Prisma.EmployeeOrderByWithRelationInput[] = [{ user: { lastName: 'asc' } }, { user: { firstName: 'asc' } }, { id: 'asc' }];

export async function grid(u: UserCtx, campaign: VacationCampaign, q: GridQuery) {
  const where = await gridWhere(u, campaign, q);
  const [emps, total] = await Promise.all([
    prisma.employee.findMany({ where, include: employeeInclude(campaign.id), orderBy: nameOrder, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.employee.count({ where }),
  ]);
  return { items: await toRows(u, campaign, emps), total, page: q.page, pageSize: q.pageSize };
}

export async function planRow(u: UserCtx, campaign: VacationCampaign, employeeId: string) {
  const e = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId }, include: employeeInclude(campaign.id) });
  return (await toRows(u, campaign, [e]))[0]!;
}

// ───────────────────────── Plan editing ─────────────────────────

export type PeriodCalc = { startDate: string; endDate: string; days: number };

/**
 * Plan rules (API.md §9, Labor Code RK art. 88/94): periods inside the campaign year, each ≥ 1 vacation day
 * (public holidays excluded), no overlaps, total ≤ entitlement, and when the total is ≥ 14 days at least one part ≥ 14.
 */
export async function validatePeriods(periods: { startDate: string; endDate: string }[], year: number, entitlement: number, tx: Tx = prisma): Promise<PeriodCalc[]> {
  const out: PeriodCalc[] = [];
  for (const [i, p] of periods.entries()) {
    if (p.endDate < p.startDate) throw businessRule('INVALID_PERIOD', 'End date is before start date', { index: i });
    if (!p.startDate.startsWith(`${year}-`) || !p.endDate.startsWith(`${year}-`)) {
      throw businessRule('PERIOD_OUTSIDE_YEAR', `Vacation periods must fall within ${year}`, { index: i });
    }
    const { days } = await leaveDays(p.startDate, p.endDate, 'VACATION', tx);
    if (days < 1) throw businessRule('NO_LEAVE_DAYS', 'A period must contain at least one vacation day', { index: i });
    out.push({ ...p, days });
  }
  out.sort((a, b) => a.startDate.localeCompare(b.startDate));
  for (let i = 1; i < out.length; i++) {
    if (out[i]!.startDate <= out[i - 1]!.endDate) throw businessRule('OVERLAP', 'Vacation periods overlap', { periods: [out[i - 1], out[i]] });
  }
  const total = out.reduce((s, p) => s + p.days, 0);
  if (total > entitlement) throw businessRule('EXCEEDS_ENTITLEMENT', `Planned ${total} days exceed the entitlement of ${entitlement}`, { planned: total, entitlement });
  if (total >= MIN_MAIN_PART && !out.some((p) => p.days >= MIN_MAIN_PART)) {
    throw businessRule('MIN_PART_14', 'At least one part of the vacation must be 14 calendar days or longer (Labor Code RK art. 94)');
  }
  return out;
}

export async function canEditPlanOf(u: UserCtx, employeeId: string) {
  if (u.employeeId === employeeId) return true;
  return (await prisma.employee.count({ where: { AND: [await managedEmployeeScope(u), { id: employeeId }] } })) > 0;
}

/** Recipients of "plan submitted": the employee's manager, or the legal entity's HR when there is none. */
async function approversOf(tx: Tx, employeeId: string): Promise<string[]> {
  const e = await tx.employee.findUniqueOrThrow({ where: { id: employeeId }, include: { manager: { select: { userId: true, status: true } } } });
  if (e.manager?.status === 'ACTIVE') return [e.manager.userId];
  return hrUsersFor(tx, e.tenantId, e.legalEntityId);
}

export async function savePlan(u: UserCtx, campaign: VacationCampaign, employeeId: string, input: VacationPlanInput) {
  if (campaign.status !== 'ACTIVE') throw businessRule('CAMPAIGN_NOT_ACTIVE', 'Planning is closed for this campaign');
  const emp = await prisma.employee.findFirst({ where: { id: employeeId, tenantId: u.tenantId }, include: { user: true } });
  if (!emp || !(await canEditPlanOf(u, employeeId))) throw notFound('Employee');
  if (emp.status !== 'ACTIVE') throw businessRule('EMPLOYEE_NOT_ACTIVE', 'The employee is not active');
  const self = u.employeeId === employeeId;
  const existing = await prisma.vacationPlan.findUnique({ where: { campaignId_employeeId: { campaignId: campaign.id, employeeId } } });
  if (existing?.status === 'APPROVED' && self && !hasRole(u, 'ADMIN', 'HR')) {
    throw businessRule('PLAN_LOCKED', 'The plan is approved; ask your manager or HR to change it');
  }
  if (input.submit && input.periods.length === 0) throw businessRule('EMPTY_PLAN', 'Add at least one vacation period before submitting');
  const periods = await validatePeriods(input.periods, campaign.year, await entitlementFor(employeeId, campaign.year));
  const status = input.submit ? 'SUBMITTED' : 'DRAFT';
  await prisma.$transaction(async (tx) => {
    const plan = await tx.vacationPlan.upsert({
      where: { campaignId_employeeId: { campaignId: campaign.id, employeeId } },
      create: { campaignId: campaign.id, employeeId, status },
      update: { status, approvedById: null, approvedAt: null, ...(input.submit ? { comment: null } : {}) },
    });
    await tx.vacationPlanPeriod.deleteMany({ where: { planId: plan.id } });
    if (periods.length) {
      await tx.vacationPlanPeriod.createMany({ data: periods.map((p) => ({ planId: plan.id, startDate: fromDateStr(p.startDate), endDate: fromDateStr(p.endDate), days: p.days })) });
    }
    await audit(u, input.submit ? 'vacation.plan_submit' : 'vacation.plan_save', 'VacationPlan', plan.id, { employeeId, periods: periods.length, days: periods.reduce((s, p) => s + p.days, 0) }, { tx });
    if (input.submit) {
      const total = periods.reduce((s, p) => s + p.days, 0);
      for (const userId of await approversOf(tx, employeeId)) {
        if (userId === u.userId) continue;
        await notify({
          tenantId: u.tenantId, userId, type: 'vacation.plan_submitted', link: SCHEDULE_LINK,
          title: `График отпусков ${campaign.year}: план на согласовании`,
          body: `${emp.user.lastName} ${emp.user.firstName}: ${periods.map((p) => `${fmtShort(p.startDate)}–${fmtShort(p.endDate)}`).join(', ')} (${total} дн.)`,
        }, tx);
      }
    }
  });
  return planRow(u, campaign, employeeId);
}

// ───────────────────────── Approval ─────────────────────────

export async function decidePlans(
  u: UserCtx, campaign: VacationCampaign,
  input: { employeeIds: string[]; decision: 'APPROVE' | 'REJECT'; comment?: string | null; dryRun?: boolean },
): Promise<BulkResult> {
  if (campaign.status !== 'ACTIVE') throw businessRule('CAMPAIGN_NOT_ACTIVE', 'The campaign is not active');
  if (input.decision === 'REJECT' && !input.dryRun && !input.comment) throw businessRule('COMMENT_REQUIRED', 'A comment is required to reject a plan');
  const ids = [...new Set(input.employeeIds)];
  const approvable = await approvableIds(u, ids);
  const plans = await prisma.vacationPlan.findMany({ where: { campaignId: campaign.id, employeeId: { in: ids } }, include: { employee: { select: { userId: true } }, periods: { orderBy: { startDate: 'asc' } } } });
  const byEmp = new Map(plans.map((p) => [p.employeeId, p]));
  const result: BulkResult = { succeeded: [], failed: [] };
  for (const employeeId of ids) {
    const plan = byEmp.get(employeeId);
    if (!approvable.has(employeeId)) result.failed.push({ employeeId, reason: 'OUT_OF_SCOPE' });
    else if (!plan || plan.periods.length === 0) result.failed.push({ employeeId, reason: 'NO_PLAN' });
    else if (plan.status !== 'SUBMITTED') result.failed.push({ employeeId, reason: `NOT_SUBMITTED:${plan.status}` });
    else result.succeeded.push(employeeId);
  }
  if (input.dryRun || !result.succeeded.length) return result;
  const approve = input.decision === 'APPROVE';
  await prisma.$transaction(async (tx) => {
    for (const employeeId of result.succeeded) {
      const plan = byEmp.get(employeeId)!;
      await tx.vacationPlan.update({
        where: { id: plan.id },
        data: { status: approve ? 'APPROVED' : 'REJECTED', approvedById: approve ? u.userId : null, approvedAt: approve ? new Date() : null, comment: input.comment ?? null },
      });
      const ranges = plan.periods.map((p) => `${fmtShort(toDateStr(p.startDate))}–${fmtShort(toDateStr(p.endDate))}`).join(', ');
      await notify({
        tenantId: u.tenantId, userId: plan.employee.userId, type: approve ? 'vacation.plan_approved' : 'vacation.plan_rejected', link: SCHEDULE_LINK,
        title: approve ? `График отпусков ${campaign.year}: план согласован` : `График отпусков ${campaign.year}: план отклонён`,
        body: input.comment ? `${ranges}. Комментарий: ${input.comment}` : ranges,
      }, tx);
    }
    await audit(u, approve ? 'vacation.plans_approve' : 'vacation.plans_reject', 'VacationCampaign', campaign.id, { employeeIds: result.succeeded, comment: input.comment ?? null }, { tx });
  });
  return result;
}

// ───────────────────────── Reminders ─────────────────────────

/**
 * Daily: an approved period starting within the next 14 days → notify the employee and their manager, once per period.
 * Returns the number of periods processed.
 */
export async function runVacationReminders(now: Date = new Date()): Promise<{ notified: number }> {
  const today = todayLocal(DEFAULT_TZ, now);
  const periods = await prisma.vacationPlanPeriod.findMany({
    where: {
      reminderSentAt: null,
      startDate: { gte: fromDateStr(today), lte: fromDateStr(addDaysStr(today, MIN_MAIN_PART)) },
      plan: { status: 'APPROVED', campaign: { status: { not: 'DRAFT' } }, employee: { status: 'ACTIVE' } },
    },
    include: { plan: { include: { campaign: true, employee: { include: { user: true, manager: { select: { userId: true, status: true } } } } } } },
    take: 5000,
  });
  for (const p of periods) {
    const e = p.plan.employee;
    const start = toDateStr(p.startDate);
    const inDays = diffDays(today, start);
    const range = `${fmtShort(start)}–${fmtShort(toDateStr(p.endDate))} (${p.days} дн.)`;
    await prisma.$transaction(async (tx) => {
      await notify({
        tenantId: e.tenantId, userId: e.userId, type: 'vacation.reminder', link: '/requests/new?type=ANNUAL_LEAVE',
        title: inDays === 0 ? 'Сегодня начинается ваш отпуск по графику' : `Через ${inDays} дн. начинается ваш отпуск по графику`,
        body: `${range}. Оформите заявление на ежегодный отпуск, если ещё не сделали этого.`,
      }, tx);
      if (e.manager?.status === 'ACTIVE') {
        await notify({
          tenantId: e.tenantId, userId: e.manager.userId, type: 'vacation.reminder', link: SCHEDULE_LINK,
          title: `Отпуск работника по графику: ${e.user.lastName} ${e.user.firstName}`,
          body: `${range}. Начало через ${inDays} дн.`,
        }, tx);
      }
      await tx.vacationPlanPeriod.update({ where: { id: p.id }, data: { reminderSentAt: now } });
    });
  }
  return { notified: periods.length };
}

export function assertManage(u: UserCtx) {
  if (!can(u, 'vacation.manage')) throw forbidden();
}

export async function createCampaign(u: UserCtx, input: { year: number; deadline?: string | null; status: 'DRAFT' | 'ACTIVE' }) {
  if (await prisma.vacationCampaign.findUnique({ where: { tenantId_year: { tenantId: u.tenantId, year: input.year } } })) {
    throw conflict(`A campaign for ${input.year} already exists`);
  }
  return prisma.$transaction(async (tx) => {
    const c = await tx.vacationCampaign.create({
      data: { tenantId: u.tenantId, year: input.year, status: input.status, deadline: input.deadline ? fromDateStr(input.deadline) : null },
    });
    await audit(u, 'vacation.campaign_create', 'VacationCampaign', c.id, { year: c.year, status: c.status }, { tx });
    if (c.status === 'ACTIVE') await notifyCampaignOpened(c, tx);
    return c;
  });
}

export async function updateCampaign(u: UserCtx, c: VacationCampaign, input: { status?: 'ACTIVE' | 'CLOSED'; deadline?: string | null }) {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.vacationCampaign.update({
      where: { id: c.id },
      data: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.deadline !== undefined ? { deadline: input.deadline ? fromDateStr(input.deadline) : null } : {}),
      },
    });
    await audit(u, 'vacation.campaign_update', 'VacationCampaign', c.id, input, { tx });
    if (c.status === 'DRAFT' && updated.status === 'ACTIVE') await notifyCampaignOpened(updated, tx);
    return updated;
  });
}
