import type { AbsenceKind } from '@prisma/client';
import { prisma, type Tx } from '../../lib/db';
import { datesInRange, holidaysInRange, type HolidayRow } from '../../lib/calendar';

/**
 * Leave length (API.md §8 Rules, Labor Code RK art. 88): calendar days in [start, end] minus public holidays
 * (Holiday.kind = HOLIDAY) falling inside the period. Carried-over days off (TRANSFER_DAY_OFF) are ordinary
 * calendar days for leave purposes. Business trips count plain calendar days.
 */
export async function leaveDays(start: string, end: string, kind: AbsenceKind | null = 'VACATION', tx: Tx = prisma): Promise<{ days: number; holidays: HolidayRow[] }> {
  if (end < start) return { days: 0, holidays: [] };
  const all = datesInRange(start, end);
  if (kind === 'BUSINESS_TRIP') return { days: all.length, holidays: [] };
  const holidays = (await holidaysInRange(start, end, tx)).filter((h) => h.kind === 'HOLIDAY');
  const skip = new Set(holidays.map((h) => h.date));
  return { days: all.filter((d) => !skip.has(d)).length, holidays };
}

export const fmtShort = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
