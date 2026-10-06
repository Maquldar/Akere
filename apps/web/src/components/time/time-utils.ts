import { APP_TIME_ZONE, toIntlLocale } from '@/lib/format';
import type { Tone } from '@/components/ui/badge';
import type { AbsenceKind, BoardStatus, ShiftColor, T13Code } from '@/lib/api/types-time';

/** Date-string helpers (YYYY-MM-DD, calendar arithmetic in UTC so DST never shifts a day). */

const pad = (n: number) => String(n).padStart(2, '0');

export function toDateStr(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function fromDateStr(s: string): Date {
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, 12));
}

export function addDays(s: string, n: number): string {
  const d = fromDateStr(s);
  d.setUTCDate(d.getUTCDate() + n);
  return toDateStr(d);
}

/** Monday of the week containing `s`. */
export function weekStart(s: string): string {
  const d = fromDateStr(s);
  const wd = (d.getUTCDay() + 6) % 7; // 0 = Monday
  return addDays(s, -wd);
}

export function weekDays(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function diffDays(a: string, b: string): number {
  return Math.round((fromDateStr(b).getTime() - fromDateStr(a).getTime()) / 86_400_000);
}

/** ISO weekday 1..7 (Mon..Sun). */
export function isoWeekday(s: string): number {
  return ((fromDateStr(s).getUTCDay() + 6) % 7) + 1;
}

export function isWeekendStr(s: string): boolean {
  return isoWeekday(s) >= 6;
}

/** Today in the company time zone. */
export function todayStr(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function monthEnd(year: number, month: number): string {
  return toDateStr(new Date(Date.UTC(year, month, 0, 12)));
}

/** "HH:MM" of an ISO instant in the company time zone. */
export function timeOf(iso: string | null | undefined, locale = 'ru'): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat(toIntlLocale(locale), { timeZone: APP_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}

/** Minutes since local midnight of `day` (may exceed 1440 for night shifts). */
export function minutesOfDay(iso: string, day: string): number {
  const local = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (t: string) => local.find((p) => p.type === t)?.value ?? '00';
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  return diffDays(day, date) * 1440 + Number(get('hour')) * 60 + Number(get('minute'));
}

export function shiftRange(s: { startAt: string; endAt: string }, locale = 'ru'): string {
  return `${timeOf(s.startAt, locale)}–${timeOf(s.endAt, locale)}`;
}

export function shiftMinutes(s: { startAt: string; endAt: string; breakMinutes: number }): number {
  return Math.max(0, (new Date(s.endAt).getTime() - new Date(s.startAt).getTime()) / 60_000 - s.breakMinutes);
}

/** "Пн", "Вт"… */
export function weekdayShort(s: string, locale: string): string {
  const w = new Intl.DateTimeFormat(toIntlLocale(locale), { weekday: 'short', timeZone: 'UTC' }).format(fromDateStr(s)).replace('.', '');
  return w.charAt(0).toLocaleUpperCase(toIntlLocale(locale)) + w.slice(1);
}

export function dayNum(s: string): number {
  return fromDateStr(s).getUTCDate();
}

/** "8 — 14 июня" / "29 июня — 5 июля". */
export function weekTitle(start: string, locale: string): string {
  const end = addDays(start, 6);
  const l = toIntlLocale(locale);
  const a = fromDateStr(start);
  const b = fromDateStr(end);
  const month = (d: Date) => new Intl.DateTimeFormat(l, { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(d);
  if (a.getUTCMonth() === b.getUTCMonth()) {
    return `${a.getUTCDate()} — ${month(b)}`;
  }
  return `${month(a)} — ${month(b)}`;
}

export function monthTitle(year: number, month: number, locale: string): string {
  const s = new Intl.DateTimeFormat(toIntlLocale(locale), { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 15)));
  const clean = s.replace(/\s?г\.$/, '');
  return clean.charAt(0).toLocaleUpperCase(toIntlLocale(locale)) + clean.slice(1);
}

/** "12 — 14 июня" for an absence span. */
export function spanTitle(from: string, to: string, locale: string): string {
  const l = toIntlLocale(locale);
  const a = fromDateStr(from);
  const b = fromDateStr(to);
  const dm = (d: Date) => new Intl.DateTimeFormat(l, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(d).replace('.', '');
  if (from === to) return dm(a);
  if (a.getUTCMonth() === b.getUTCMonth()) return `${a.getUTCDate()} — ${dm(b)}`;
  return `${dm(a)} — ${dm(b)}`;
}

export function hoursNum(h: number, locale: string, digits = 1): string {
  return new Intl.NumberFormat(toIntlLocale(locale), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(h);
}

export function compactHours(h: number, locale: string): string {
  return new Intl.NumberFormat(toIntlLocale(locale), { maximumFractionDigits: 1 }).format(h);
}

/** Splits minutes for the `duration` message ({h}ч {m}м). */
export function hm(totalMinutes: number): { h: number; m: number } {
  const v = Math.round(Math.abs(totalMinutes));
  return { h: Math.floor(v / 60), m: v % 60 };
}

// ── Colors ──

/** Chip background + left accent per shift color (tokens from globals.css). */
export const shiftChipClass: Record<ShiftColor, { bg: string; bar: string; text: string; dot: string }> = {
  green: { bg: 'bg-shift-green border-green-border', bar: 'bg-green-solid', text: 'text-green-fg', dot: 'bg-green-solid' },
  teal: { bg: 'bg-shift-teal border-teal-border', bar: 'bg-teal-solid', text: 'text-teal-fg', dot: 'bg-teal-solid' },
  blue: { bg: 'bg-shift-blue border-blue-border', bar: 'bg-blue-solid', text: 'text-blue-fg', dot: 'bg-blue-solid' },
  orange: { bg: 'bg-shift-orange border-orange-border', bar: 'bg-orange-solid', text: 'text-orange-fg', dot: 'bg-orange-solid' },
  purple: { bg: 'bg-shift-purple border-purple-border', bar: 'bg-purple-solid', text: 'text-purple-fg', dot: 'bg-purple-solid' },
  gray: { bg: 'bg-surface border-border-strong', bar: 'bg-fg-muted', text: 'text-fg', dot: 'bg-gray-solid' },
  red: { bg: 'bg-shift-red border-red-border', bar: 'bg-red-solid', text: 'text-red-fg', dot: 'bg-red-solid' },
};

export const shiftTone: Record<ShiftColor, Tone> = {
  green: 'green', teal: 'teal', blue: 'blue', orange: 'orange', purple: 'purple', gray: 'gray', red: 'red',
};

export const absenceTone: Record<AbsenceKind, Tone> = {
  VACATION: 'green',
  UNPAID: 'orange',
  SICK: 'red',
  BUSINESS_TRIP: 'blue',
  OTHER: 'gray',
};

export const boardTone: Record<BoardStatus, Tone> = {
  NORMAL: 'green',
  LATE: 'orange',
  NO_OUT: 'red',
  NO_MARKS: 'red',
  UNDERWORK: 'orange',
  OVERTIME: 'purple',
  ON_SHIFT: 'blue',
  NOT_STARTED: 'gray',
  ABSENT: 'blue',
  DAY_OFF: 'gray',
};

export const t13CodeClass: Record<T13Code, string> = {
  Я: 'text-fg-muted',
  В: 'text-fg-subtle',
  К: 'text-blue-fg',
  Б: 'text-blue-fg',
  О: 'text-green-fg',
  БС: 'text-green-fg',
  НН: 'text-red-fg',
  РВ: 'text-purple-fg',
  Н: 'text-purple-fg',
  С: 'text-orange-fg',
  П: 'text-fg-subtle',
};

export const T13_CODE_LIST: T13Code[] = ['Я', 'В', 'К', 'Б', 'О', 'БС', 'НН', 'РВ', 'Н', 'С', 'П'];

/** Stable key for T-13 code translations (Cyrillic keys are fine in JSON but awkward in code). */
export const t13CodeKey = {
  Я: 'present', В: 'dayOff', К: 'trip', Б: 'sick', О: 'vacation', БС: 'unpaid', НН: 'absence', РВ: 'dayOffWork', Н: 'night', С: 'overtime', П: 'holiday',
} as const satisfies Record<T13Code, string>;
