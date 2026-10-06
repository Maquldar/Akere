import type { HolidayKind } from '@prisma/client';
import { prisma, type Tx } from './db';

/**
 * Production calendar (KZ) and tenant-timezone helpers.
 *
 * Dates are `YYYY-MM-DD` strings (DateStr) everywhere in this file. A "local" date/time means the
 * tenant's timezone (Tenant.settings.timezone, default Asia/Almaty = UTC+5, no DST).
 * The Holiday table is shared by all tenants:
 *  - HOLIDAY            public holiday (day off)
 *  - TRANSFER_DAY_OFF   weekday made a day off (holiday carry-over)
 *  - TRANSFER_WORKDAY   weekend day made a working day
 */

export const DEFAULT_TZ = 'Asia/Almaty';
export const HOURS_PER_DAY = 8;
const DAY_MS = 86_400_000;

// ───────────── DateStr helpers ─────────────

const asUtc = (d: string) => new Date(`${d}T00:00:00.000Z`);
export const dateStrOf = (d: Date) => d.toISOString().slice(0, 10);
export const addDaysStr = (d: string, n: number) => dateStrOf(new Date(asUtc(d).getTime() + n * DAY_MS));
export const diffDays = (from: string, to: string) => Math.round((asUtc(to).getTime() - asUtc(from).getTime()) / DAY_MS);
/** 0 = Sunday … 6 = Saturday. */
export const weekdayOf = (d: string) => asUtc(d).getUTCDay();
/** 1 = Monday … 7 = Sunday. */
export const isoWeekdayOf = (d: string) => ((weekdayOf(d) + 6) % 7) + 1;
export const isWeekend = (d: string) => {
  const w = weekdayOf(d);
  return w === 0 || w === 6;
};
export const startOfWeek = (d: string) => addDaysStr(d, 1 - isoWeekdayOf(d));
export const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
export const monthBounds = (year: number, month: number) => {
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  return { from, to: addDaysStr(from, daysInMonth(year, month) - 1) };
};
/** Inclusive list of dates. */
export function datesInRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDaysStr(d, 1)) out.push(d);
  return out;
}

// ───────────── Timezone helpers ─────────────

const dtf = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string) {
  let f = dtf.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    dtf.set(tz, f);
  }
  return f;
}

function localParts(at: Date, tz: string) {
  const p: Record<string, number> = {};
  for (const part of formatter(tz).formatToParts(at)) if (part.type !== 'literal') p[part.type] = Number(part.value);
  return { y: p.year!, m: p.month!, d: p.day!, h: p.hour! % 24, mi: p.minute!, s: p.second! };
}

/** Offset of `tz` from UTC at the given instant, in minutes (Asia/Almaty → 300). */
export function tzOffsetMinutes(tz: string, at: Date): number {
  const p = localParts(at, tz);
  const asIfUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return Math.round((asIfUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/** Local calendar date of an instant. */
export function localDateStr(at: Date, tz: string): string {
  const p = localParts(at, tz);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** Local minute of day (0…1439) of an instant. */
export function localMinuteOfDay(at: Date, tz: string): number {
  const p = localParts(at, tz);
  return p.h * 60 + p.mi;
}

/** "HH:MM" local time of an instant. */
export function localTimeStr(at: Date, tz: string): string {
  const m = localMinuteOfDay(at, tz);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** UTC instant for a local date + "HH:MM" wall time. */
export function localToUtc(date: string, hhmm: string, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [h, mi] = hhmm.split(':').map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const off = tzOffsetMinutes(tz, new Date(guess));
  let t = guess - off * 60_000;
  const off2 = tzOffsetMinutes(tz, new Date(t));
  if (off2 !== off) t = guess - off2 * 60_000;
  return new Date(t);
}

/** [start, end) UTC instants of a local calendar day. */
export function localDayBounds(date: string, tz: string) {
  return { start: localToUtc(date, '00:00', tz), end: localToUtc(addDaysStr(date, 1), '00:00', tz) };
}

export const todayLocal = (tz: string, now: Date = new Date()) => localDateStr(now, tz);

/** Shift instants from a local date and "HH:MM" bounds; an end at or before the start crosses midnight. */
export function shiftInstants(date: string, startTime: string, endTime: string, tz: string) {
  const startAt = localToUtc(date, startTime, tz);
  const endAt = localToUtc(endTime <= startTime ? addDaysStr(date, 1) : date, endTime, tz);
  return { startAt, endAt };
}

export const timeToMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

// ───────────── Tenant time settings ─────────────

export type TimeSettings = { requireSelfie: boolean; requireGeofence: boolean; timezone: string };

export function parseTimeSettings(settings: unknown): TimeSettings {
  const s = (settings && typeof settings === 'object' ? settings : {}) as Record<string, unknown>;
  let timezone = typeof s.timezone === 'string' && s.timezone ? s.timezone : DEFAULT_TZ;
  try {
    formatter(timezone);
  } catch {
    timezone = DEFAULT_TZ;
  }
  return { requireSelfie: s.requireSelfie === true, requireGeofence: s.requireGeofence === true, timezone };
}

export async function tenantTimeSettings(tenantId: string, tx: Tx = prisma): Promise<TimeSettings> {
  const t = await tx.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
  return parseTimeSettings(t?.settings);
}

export async function tenantTimezone(tenantId: string, tx: Tx = prisma) {
  return (await tenantTimeSettings(tenantId, tx)).timezone;
}

// ───────────── Production calendar ─────────────

export type HolidayRow = { date: string; kind: HolidayKind; name: string };
export type Calendar = Map<string, HolidayRow>;

export const buildCalendar = (rows: HolidayRow[]): Calendar => new Map(rows.map((r) => [r.date, r]));

/** A public holiday or a carried-over day off (not a regular weekend). */
export function isPublicHoliday(date: string, cal: Calendar): boolean {
  const h = cal.get(date);
  return !!h && (h.kind === 'HOLIDAY' || h.kind === 'TRANSFER_DAY_OFF');
}

/** Working day under the 5-day week + production calendar. */
export function isWorkingDay(date: string, cal: Calendar): boolean {
  const h = cal.get(date);
  if (h?.kind === 'TRANSFER_WORKDAY') return true;
  if (h) return false;
  return !isWeekend(date);
}

export type DayKind = 'WORK' | 'WEEKEND' | 'HOLIDAY';
export function dayKind(date: string, cal: Calendar): DayKind {
  if (isWorkingDay(date, cal)) return 'WORK';
  return isPublicHoliday(date, cal) ? 'HOLIDAY' : 'WEEKEND';
}

export function countWorkingDays(from: string, to: string, cal: Calendar): number {
  let n = 0;
  for (let d = from; d <= to; d = addDaysStr(d, 1)) if (isWorkingDay(d, cal)) n++;
  return n;
}

/** Norm hours for a period: working days × 8 (40-hour week). */
export const normHoursFor = (from: string, to: string, cal: Calendar) => countWorkingDays(from, to, cal) * HOURS_PER_DAY;

export async function holidaysInRange(from: string, to: string, tx: Tx = prisma): Promise<HolidayRow[]> {
  const rows = await tx.holiday.findMany({ where: { date: { gte: asUtc(from), lte: asUtc(to) } }, orderBy: { date: 'asc' } });
  return rows.map((r) => ({ date: dateStrOf(r.date), kind: r.kind, name: r.name }));
}

export async function loadCalendar(from: string, to: string, tx: Tx = prisma): Promise<Calendar> {
  return buildCalendar(await holidaysInRange(from, to, tx));
}

export async function workingDaysInMonth(year: number, month: number, tx: Tx = prisma): Promise<number> {
  const { from, to } = monthBounds(year, month);
  return countWorkingDays(from, to, await loadCalendar(from, to, tx));
}

export async function normHours(from: string, to: string, tx: Tx = prisma): Promise<number> {
  return normHoursFor(from, to, await loadCalendar(from, to, tx));
}

export async function normHoursForMonth(year: number, month: number, tx: Tx = prisma): Promise<number> {
  return (await workingDaysInMonth(year, month, tx)) * HOURS_PER_DAY;
}

/** Working days strictly needed for leave/requests: the list of working dates in a range. */
export async function workingDatesInRange(from: string, to: string, tx: Tx = prisma): Promise<string[]> {
  const cal = await loadCalendar(from, to, tx);
  return datesInRange(from, to).filter((d) => isWorkingDay(d, cal));
}
