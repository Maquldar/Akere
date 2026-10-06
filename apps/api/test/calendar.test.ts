import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/db';
import {
  addDaysStr, buildCalendar, countWorkingDays, dayKind, holidaysInRange, isPublicHoliday, isWorkingDay, localDateStr, localDayBounds, localMinuteOfDay,
  localToUtc, monthBounds, normHours, normHoursForMonth, parseTimeSettings, shiftInstants, startOfWeek, tzOffsetMinutes, workingDaysInMonth,
} from '../src/lib/calendar';
import { kzHolidays } from '../prisma/seed/kz';
import { resetDb } from './helpers';

beforeEach(resetDb);

async function seedHolidays(year: number) {
  await prisma.holiday.createMany({ data: kzHolidays(year).map((h) => ({ date: new Date(`${h.date}T00:00:00Z`), kind: h.kind, name: h.name })) });
}

describe('production calendar', () => {
  it('handles timezone conversion for Asia/Almaty (UTC+5)', () => {
    const tz = 'Asia/Almaty';
    expect(tzOffsetMinutes(tz, new Date('2026-01-15T00:00:00Z'))).toBe(300);
    expect(localToUtc('2026-10-06', '09:00', tz).toISOString()).toBe('2026-10-06T04:00:00.000Z');
    expect(localDateStr(new Date('2026-10-06T20:30:00Z'), tz)).toBe('2026-10-07');
    expect(localMinuteOfDay(new Date('2026-10-06T20:30:00Z'), tz)).toBe(90);
    expect(localDayBounds('2026-10-06', tz).start.toISOString()).toBe('2026-10-05T19:00:00.000Z');
    const night = shiftInstants('2026-10-06', '20:00', '08:00', tz);
    expect(night.endAt.toISOString()).toBe('2026-10-07T03:00:00.000Z');
    expect(parseTimeSettings({}).timezone).toBe('Asia/Almaty');
    expect(parseTimeSettings({ timezone: 'Nope/Zone', requireSelfie: true })).toEqual({ timezone: 'Asia/Almaty', requireSelfie: true, requireGeofence: false });
  });

  it('date helpers', () => {
    expect(addDaysStr('2026-02-28', 1)).toBe('2026-03-01');
    expect(startOfWeek('2026-10-11')).toBe('2026-10-05');
    expect(monthBounds(2026, 2)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });

  it('classifies days with holidays and transfers (pure)', () => {
    const cal = buildCalendar([
      { date: '2026-03-23', kind: 'HOLIDAY', name: 'Наурыз' },
      { date: '2026-03-24', kind: 'TRANSFER_DAY_OFF', name: 'Перенос' },
      { date: '2026-03-28', kind: 'TRANSFER_WORKDAY', name: 'Рабочая суббота' },
    ]);
    expect(isWorkingDay('2026-03-23', cal)).toBe(false);
    expect(isWorkingDay('2026-03-24', cal)).toBe(false);
    expect(isWorkingDay('2026-03-25', cal)).toBe(true);
    expect(isWorkingDay('2026-03-28', cal)).toBe(true); // Saturday made a workday
    expect(isWorkingDay('2026-03-29', cal)).toBe(false); // Sunday
    expect(isPublicHoliday('2026-03-24', cal)).toBe(true);
    expect(dayKind('2026-03-29', cal)).toBe('WEEKEND');
    expect(dayKind('2026-03-23', cal)).toBe('HOLIDAY');
    expect(countWorkingDays('2026-03-23', '2026-03-29', cal)).toBe(4);
  });

  it('computes norm hours from the seeded KZ calendar', async () => {
    await seedHolidays(2026);
    // October 2026: 22 weekdays, Republic Day (Sun 25.10) carried over to Mon 26.10 → 21 working days.
    expect(await workingDaysInMonth(2026, 10)).toBe(21);
    expect(await normHoursForMonth(2026, 10)).toBe(168);
    // March 2026: 22 weekdays; 8 (Sun→Mon 9), 21 Sat→Tue 24, 22 Sun→Wed 25, 23 Mon → 9,23,24,25 off → 18.
    expect(await workingDaysInMonth(2026, 3)).toBe(18);
    expect(await normHours('2026-10-05', '2026-10-11')).toBe(40);
    const hol = await holidaysInRange('2026-10-01', '2026-10-31');
    expect(hol.map((h) => h.date)).toEqual(['2026-10-25', '2026-10-26']);
    expect(hol[1]!.kind).toBe('TRANSFER_DAY_OFF');
  });
});
