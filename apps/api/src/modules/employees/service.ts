import type { Prisma } from '@prisma/client';
import { prisma, type Tx } from '../../lib/db';
import { on } from '../../lib/hooks';
import { audit } from '../../lib/audit';
import { fileUrl } from '../../lib/files';
import { fullName, toUserRef, userRefSelect } from '../../lib/names';
import { toDateStr, todayUtc } from '../../lib/dates';

// ───────────────────────── Vacation balance (F-28) ─────────────────────────

/** Whole months between two dates (a month counts once the same day-of-month is reached). */
export function fullMonthsBetween(from: Date, to: Date): number {
  if (to < from) return 0;
  let months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * accrued = vacationDaysPerYear × full months worked since hireDate / 12 (+ manual ACCRUAL ledger entries, e.g. carry-over),
 * used = Σ USAGE, adjusted = Σ ADJUSTMENT (signed), available = accrued + adjusted − used. Rounded to 2 decimals.
 * Requests (P4) write USAGE rows with positive `days` when a leave order completes.
 */
export async function getVacationBalance(employeeId: string, tx: Tx = prisma, at: Date = todayUtc()) {
  const emp = await tx.employee.findUniqueOrThrow({ where: { id: employeeId } });
  const ledger = await tx.vacationLedger.findMany({ where: { employeeId }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] });
  return computeVacationBalance(emp, ledger, at);
}

type BalanceEmployee = { status: string; terminationDate: Date | null; hireDate: Date; vacationDaysPerYear: number };
type LedgerRow = { id: string; type: string; days: Prisma.Decimal | number; date: Date; note: string | null };

/** Pure balance computation (see getVacationBalance); `ledger` sorted newest first. */
export function computeVacationBalance(emp: BalanceEmployee, ledger: LedgerRow[], at: Date = todayUtc()) {
  const end = emp.status === 'TERMINATED' && emp.terminationDate && emp.terminationDate < at ? emp.terminationDate : at;
  const months = fullMonthsBetween(emp.hireDate, end);
  const sum = (type: string) => ledger.filter((l) => l.type === type).reduce((s, l) => s + Number(l.days), 0);
  const accrued = round2((emp.vacationDaysPerYear * months) / 12 + sum('ACCRUAL'));
  const used = round2(ledger.filter((l) => l.type === 'USAGE').reduce((s, l) => s + Math.abs(Number(l.days)), 0));
  const adjusted = round2(sum('ADJUSTMENT'));
  return {
    available: round2(accrued + adjusted - used),
    accrued,
    used,
    adjusted,
    perYear: emp.vacationDaysPerYear,
    entries: ledger.map((l) => ({ id: l.id, type: l.type, days: Number(l.days), date: toDateStr(l.date), note: l.note })),
  };
}

/** Balances of many employees with two queries (employees + ledgers). */
export async function getVacationBalances(employeeIds: string[], tx: Tx = prisma, at: Date = todayUtc()) {
  const out = new Map<string, ReturnType<typeof computeVacationBalance>>();
  if (!employeeIds.length) return out;
  const [emps, ledger] = await Promise.all([
    tx.employee.findMany({ where: { id: { in: employeeIds } } }),
    tx.vacationLedger.findMany({ where: { employeeId: { in: employeeIds } }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] }),
  ]);
  const byEmp = new Map<string, typeof ledger>();
  for (const l of ledger) {
    const list = byEmp.get(l.employeeId) ?? [];
    list.push(l);
    byEmp.set(l.employeeId, list);
  }
  for (const e of emps) out.set(e.id, computeVacationBalance(e, byEmp.get(e.id) ?? [], at));
  return out;
}

// ───────────────────────── Views ─────────────────────────

export const employeeListInclude = {
  user: { select: { id: true, firstName: true, lastName: true, middleName: true, email: true, phone: true } },
  legalEntity: { select: { id: true, name: true } },
  department: { select: { id: true, name: true } },
  position: { select: { id: true, name: true } },
  manager: { select: { user: { select: userRefSelect } } },
} satisfies Prisma.EmployeeInclude;
export type EmployeeListRow = Prisma.EmployeeGetPayload<{ include: typeof employeeListInclude }>;

export function toEmployeeListItem(e: EmployeeListRow) {
  return {
    id: e.id,
    userId: e.userId,
    fullName: fullName(e.user),
    tabNumber: e.tabNumber,
    legalEntity: e.legalEntity,
    department: e.department,
    position: e.position,
    manager: e.manager ? toUserRef(e.manager.user) : null,
    status: e.status,
    hireDate: toDateStr(e.hireDate),
    email: e.user.email,
    phone: e.user.phone,
  };
}

// ───────────────────────── HR event effects (F-30) ─────────────────────────

/** A manager must be another employee of the same tenant whose own manager chain does not lead back to the employee. */
async function validManager(tx: Tx, emp: { id: string; tenantId: string }, managerId: string): Promise<boolean> {
  if (managerId === emp.id) return false;
  if (!(await tx.employee.count({ where: { id: managerId, tenantId: emp.tenantId } }))) return false;
  const cycle = await tx.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE chain AS (
      SELECT id, "managerId", 1 AS depth FROM "Employee" WHERE id = ${managerId}
      UNION
      SELECT e.id, e."managerId", c.depth + 1 FROM "Employee" e JOIN chain c ON e.id = c."managerId" WHERE c.depth < 100
    ) SELECT id FROM chain WHERE id = ${emp.id} LIMIT 1`;
  return cycle.length === 0;
}

/** Applies transfer/dismissal orders once their route completes (runs inside the route engine's transaction). */
export async function applyHrEventDocument(documentId: string, tx: Tx = prisma) {
  const doc = await tx.document.findUnique({ where: { id: documentId }, include: { documentType: { select: { code: true } } } });
  if (!doc?.subjectEmployeeId) return;
  const data = (doc.data ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof data[k] === 'string' && data[k] ? (data[k] as string) : undefined);
  if (doc.documentType.code === 'TRANSFER_ORDER') {
    const emp = await tx.employee.findUniqueOrThrow({ where: { id: doc.subjectEmployeeId }, select: { id: true, tenantId: true, legalEntityId: true } });
    const patch: Prisma.EmployeeUncheckedUpdateInput = {};
    const skipped: string[] = [];
    // Document.data is free-form JSON: every id is validated against the tenant before it touches the employee (M5).
    const departmentId = str('departmentId');
    if (departmentId) {
      const ok = await tx.department.count({ where: { id: departmentId, tenantId: emp.tenantId, legalEntityId: emp.legalEntityId } });
      if (ok) patch.departmentId = departmentId;
      else skipped.push('departmentId');
    }
    const positionId = str('positionId');
    if (positionId) {
      if (await tx.position.count({ where: { id: positionId, tenantId: emp.tenantId } })) patch.positionId = positionId;
      else skipped.push('positionId');
    }
    const managerId = str('managerId');
    if (managerId) {
      if (await validManager(tx, emp, managerId)) patch.managerId = managerId;
      else skipped.push('managerId');
    }
    if (Object.keys(patch).length) await tx.employee.update({ where: { id: doc.subjectEmployeeId }, data: patch });
    if (skipped.length) {
      await tx.documentComment.create({
        data: { documentId, authorId: doc.authorId, text: `Перевод применён частично: пропущены недопустимые поля (${skipped.join(', ')})` },
      });
    }
    await audit({ tenantId: doc.tenantId }, 'employee.transfer_applied', 'Employee', doc.subjectEmployeeId, { documentId, ...patch, skipped } as Prisma.InputJsonValue, { tx });
  } else if (doc.documentType.code === 'DISMISSAL_ORDER') {
    const effective = str('effectiveDate');
    const emp = await tx.employee.update({
      where: { id: doc.subjectEmployeeId },
      data: { status: 'TERMINATED', terminationDate: effective ? new Date(`${effective}T00:00:00Z`) : todayUtc() },
    });
    await tx.user.update({ where: { id: emp.userId }, data: { isActive: false } });
    await tx.session.deleteMany({ where: { userId: emp.userId } });
    await tx.deputy.deleteMany({ where: { OR: [{ deputyUserId: emp.userId }, { principalUserId: emp.userId }], endDate: { gte: todayUtc() } } });
    await audit({ tenantId: doc.tenantId }, 'employee.dismissal_applied', 'Employee', emp.id, { documentId, effectiveDate: effective ?? null }, { tx });
  }
}

on('document.completed', async ({ documentId }, tx) => {
  await applyHrEventDocument(documentId, tx ?? prisma);
});

export const photoUrl = (photoFileId: string | null) => (photoFileId ? fileUrl(photoFileId) : null);
