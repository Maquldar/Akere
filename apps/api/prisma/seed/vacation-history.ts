import type { PrismaClient } from '@prisma/client';
import { rng } from './kz';
import type { OrgCtx } from './org';

/**
 * Pre-system vacation history: for every full past calendar year an employee worked, record that 80–100 %
 * of the year's accrual was already used (VacationLedger USAGE). Without it balances would accumulate since
 * the hire date and show unrealistic 150+ day entitlements.
 */
export async function seedVacationHistory(prisma: PrismaClient, ctx: OrgCtx) {
  const r = rng(77);
  const currentYear = new Date().getUTCFullYear();
  const employees = await prisma.employee.findMany({ where: { tenantId: ctx.tenantId } });
  const rows = [];
  for (const e of employees) {
    for (let y = e.hireDate.getUTCFullYear(); y < currentYear; y++) {
      const from = y === e.hireDate.getUTCFullYear() ? e.hireDate : new Date(Date.UTC(y, 0, 1));
      const months = 12 - from.getUTCMonth() - (from.getUTCDate() > 1 ? 1 : 0);
      const accrued = (e.vacationDaysPerYear * months) / 12;
      const used = Math.floor(accrued * (0.8 + r() * 0.2));
      if (used <= 0) continue;
      rows.push({
        tenantId: ctx.tenantId, employeeId: e.id, type: 'USAGE' as const, days: used,
        date: new Date(Date.UTC(y, 7, 1)), note: `Отпуск за ${y} год (до внедрения Akere HR)`,
      });
    }
  }
  await prisma.vacationLedger.createMany({ data: rows });
  return {};
}
