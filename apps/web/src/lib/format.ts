/** Locale-aware date helpers (Intl). Dates from the API are ISO strings or YYYY-MM-DD. */

export const APP_TIME_ZONE = 'Asia/Almaty';

const intlLocale: Record<string, string> = { ru: 'ru-RU', kk: 'kk-KZ', en: 'en-GB' };

export function toIntlLocale(locale: string): string {
  return intlLocale[locale] ?? locale;
}

/** Parses an API date. Date-only strings are treated as calendar dates (no TZ shift). */
export function parseApiDate(value: string | Date): Date {
  if (value instanceof Date) return value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number) as [number, number, number];
    return new Date(Date.UTC(y, m - 1, d, 12));
  }
  return new Date(value);
}

function isDateOnly(value: string | Date): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function fmt(value: string | Date, locale: string, options: Intl.DateTimeFormatOptions, timeZone = APP_TIME_ZONE) {
  const date = parseApiDate(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(toIntlLocale(locale), {
    ...options,
    timeZone: isDateOnly(value) ? 'UTC' : timeZone,
  }).format(date);
}

/** 06.10.2026 */
export function formatDate(value: string | Date | null | undefined, locale: string, timeZone?: string): string {
  if (!value) return '';
  return fmt(value, locale, { day: '2-digit', month: '2-digit', year: 'numeric' }, timeZone);
}

/** 06.10.2026, 14:30 */
export function formatDateTime(value: string | Date | null | undefined, locale: string, timeZone?: string): string {
  if (!value) return '';
  return fmt(value, locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }, timeZone);
}

/** "понедельник, 22 июня" — capitalized first letter, like M4. */
export function formatLongDate(value: string | Date, locale: string, timeZone?: string): string {
  const s = fmt(value, locale, { weekday: 'long', day: 'numeric', month: 'long' }, timeZone);
  return s.charAt(0).toLocaleUpperCase(toIntlLocale(locale)) + s.slice(1);
}

/** "5 минут назад" / "2 days ago". Falls back to a date for anything older than 7 days. */
export function formatRelative(value: string | Date, locale: string, now: Date = new Date()): string {
  const date = parseApiDate(value);
  const diffSec = Math.round((date.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat(toIntlLocale(locale), { numeric: 'auto' });
  if (abs < 60) return rtf.format(diffSec, 'second');
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  if (abs < 7 * 86400) return rtf.format(Math.round(diffSec / 86400), 'day');
  return formatDate(date, locale);
}

/** Part of the day in the app time zone, for greetings. */
export function dayPart(now: Date = new Date(), timeZone = APP_TIME_ZONE): 'morning' | 'day' | 'evening' | 'night' {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone }).format(now));
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'day';
  if (hour >= 18 && hour < 23) return 'evening';
  return 'night';
}
