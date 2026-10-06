import { describe, expect, it } from 'vitest';
import { dayPart, formatDate, formatDateTime, formatLongDate, formatRelative, parseApiDate } from './format';

describe('format', () => {
  it('parses date-only strings without shifting the day', () => {
    expect(parseApiDate('2026-06-22').getUTCDate()).toBe(22);
    expect(formatDate('2026-06-22', 'ru')).toBe('22.06.2026');
  });
  it('formats timestamps in Asia/Almaty', () => {
    // 09:30Z → 14:30 in UTC+5
    expect(formatDateTime('2026-10-06T09:30:00.000Z', 'ru')).toContain('14:30');
  });
  it('builds a capitalized long date per locale', () => {
    expect(formatLongDate('2026-06-22', 'ru')).toBe('Понедельник, 22 июня');
    expect(formatLongDate('2026-06-22', 'en')).toMatch(/^Monday/);
  });
  it('returns empty string for missing/invalid values', () => {
    expect(formatDate(null, 'ru')).toBe('');
    expect(formatDate('not-a-date', 'ru')).toBe('');
  });
  it('formats relative times', () => {
    const now = new Date('2026-10-06T10:00:00Z');
    expect(formatRelative('2026-10-06T09:55:00Z', 'en', now)).toBe('5 minutes ago');
    expect(formatRelative('2026-09-01T09:55:00Z', 'ru', now)).toBe('01.09.2026');
  });
  it('computes the part of day in the app time zone', () => {
    expect(dayPart(new Date('2026-10-06T03:00:00Z'))).toBe('morning'); // 08:00 local
    expect(dayPart(new Date('2026-10-06T09:00:00Z'))).toBe('day'); // 14:00 local
    expect(dayPart(new Date('2026-10-06T15:00:00Z'))).toBe('evening'); // 20:00 local
    expect(dayPart(new Date('2026-10-06T20:00:00Z'))).toBe('night'); // 01:00 local
  });
});
