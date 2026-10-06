import { describe, expect, it } from 'vitest';
import {
  allowedNextMarks, boardSegments, buildIntervals, currentSessionLast, groupMarksByDay, haversineM, insideGeofence, nightMinutes, patternWorks,
  plannedMinutesOf, splitOvertime, summarizeDay, t13Cell, DAY_OFF_WORK_TITLE, type DayInput, type MarkLike,
} from '../src/modules/time/compute';
import { localToUtc } from '../src/lib/calendar';

const TZ = 'Asia/Almaty';
const at = (date: string, hhmm: string) => localToUtc(date, hhmm, TZ);
const D = '2026-06-22'; // Monday
const shift = (start = '10:00', end = '19:00', breakMinutes = 60, date = D, title = '5/2 Разработка') => ({
  startAt: at(date, start), endAt: end <= start ? at(nextDay(date), end) : at(date, end), breakMinutes, title,
});
const nextDay = (d: string) => new Date(new Date(`${d}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
const marks = (date: string, ...xs: [MarkLike['type'], string][]): MarkLike[] => xs.map(([type, t]) => ({ type, at: at(date, t) }));

function day(over: Partial<DayInput>): ReturnType<typeof summarizeDay> {
  return summarizeDay({
    date: D, today: '2026-06-30', now: at('2026-06-30', '12:00'), tz: TZ, shift: shift(), marks: [], absenceKind: null, publicHoliday: false, ...over,
  });
}

describe('time computations', () => {
  it('converts local times to UTC (Asia/Almaty = UTC+5)', () => {
    expect(at(D, '10:00').toISOString()).toBe('2026-06-22T05:00:00.000Z');
    expect(plannedMinutesOf(shift())).toBe(480);
  });

  it('computes a normal day with a break', () => {
    const s = day({ marks: marks(D, ['IN', '09:40'], ['BREAK_START', '13:00'], ['BREAK_END', '14:00'], ['OUT', '19:02']) });
    expect(s.workedMinutes).toBe(482); // arriving 20 min early is not working time
    expect(s.inAt!.toISOString()).toBe(at(D, '09:40').toISOString());
    expect(s.breakMinutes).toBe(60);
    expect(s.lateMinutes).toBe(0);
    expect(s.overtimeMinutes).toBe(0);
    expect(s.dayStatus).toBe('FINISHED');
    expect(s.boardStatus).toBe('NORMAL');
    expect(s.isDeviation).toBe(false);
  });

  it('deducts the scheduled break when no break was marked on a closed day', () => {
    const s = day({ marks: marks(D, ['IN', '10:00'], ['OUT', '19:00']) });
    expect(s.workedMinutes).toBe(480);
    expect(s.breakMinutes).toBe(60);
    expect(s.boardStatus).toBe('NORMAL');
    // Short presence keeps all minutes; open sessions are never auto-deducted.
    expect(day({ marks: marks(D, ['IN', '10:00'], ['OUT', '14:30']) }).workedMinutes).toBe(270);
    expect(day({ today: D, now: at(D, '18:00'), marks: marks(D, ['IN', '10:00']) }).workedMinutes).toBe(480);
  });

  it('applies the 5-minute grace for lateness and early leave', () => {
    expect(day({ marks: marks(D, ['IN', '10:05'], ['OUT', '19:00']) }).lateMinutes).toBe(0);
    const late = day({ marks: marks(D, ['IN', '10:12'], ['BREAK_START', '13:00'], ['BREAK_END', '13:50'], ['OUT', '19:00']) });
    expect(late.lateMinutes).toBe(12);
    expect(late.boardStatus).toBe('LATE');
    expect(late.isDeviation).toBe(true);
    const early = day({ marks: marks(D, ['IN', '10:00'], ['BREAK_START', '13:00'], ['BREAK_END', '14:00'], ['OUT', '18:50']) });
    expect(early.earlyLeaveMinutes).toBe(10);
    expect(early.boardStatus).toBe('NORMAL'); // 10 min short is within the 15-min tolerance
  });

  it('flags underwork beyond 15 minutes', () => {
    const s = day({ marks: marks(D, ['IN', '10:00'], ['BREAK_START', '13:00'], ['BREAK_END', '14:00'], ['OUT', '18:00']) });
    expect(s.workedMinutes).toBe(420);
    expect(s.boardStatus).toBe('UNDERWORK');
    expect(s.deviationMinutes).toBe(-60);
  });

  it('splits overtime into 1.5x for the first 2 hours and 2x beyond', () => {
    const s = day({ marks: marks(D, ['IN', '10:00'], ['BREAK_START', '13:00'], ['BREAK_END', '14:00'], ['OUT', '22:00']) });
    expect(s.workedMinutes).toBe(660);
    expect(s.overtimeMinutes).toBe(180);
    expect(s.overtime15Minutes).toBe(120);
    expect(s.overtime2Minutes).toBe(60);
    expect(s.boardStatus).toBe('OVERTIME');
    // overtime within 15 minutes is ignored
    expect(day({ marks: marks(D, ['IN', '10:00'], ['BREAK_START', '13:00'], ['BREAK_END', '14:00'], ['OUT', '19:10']) }).overtimeMinutes).toBe(0);
    expect(splitOvertime(90, false)).toEqual({ ot15: 90, ot2: 0 });
    expect(splitOvertime(90, true)).toEqual({ ot15: 0, ot2: 90 });
  });

  it('pays weekend / holiday work at 2x entirely', () => {
    const sat = '2026-06-27';
    const s = day({ date: sat, shift: null, marks: marks(sat, ['IN', '10:00'], ['OUT', '14:00']) });
    expect(s.workedMinutes).toBe(240);
    expect(s.offDayWork).toBe(true);
    expect(s.overtime2Minutes).toBe(240);
    expect(s.overtime15Minutes).toBe(0);
    const approved = day({ date: sat, shift: shift('10:00', '14:00', 0, sat, DAY_OFF_WORK_TITLE), marks: marks(sat, ['IN', '10:00'], ['OUT', '14:00']) });
    expect(approved.overtime2Minutes).toBe(240);
    expect(approved.isDeviation).toBe(false);
    const holiday = day({ publicHoliday: true, marks: marks(D, ['IN', '10:00'], ['BREAK_START', '13:00'], ['BREAK_END', '14:00'], ['OUT', '19:00']) });
    expect(holiday.overtime2Minutes).toBe(480);
    const cell = t13Cell(s, { today: '2026-06-30', absenceKind: null, hasShift: false, publicHoliday: false, weekendOrOff: true });
    expect(cell.codes).toEqual(['РВ']);
    expect(cell.hours).toBe(4);
  });

  it('counts night hours between 22:00 and 06:00 for a shift crossing midnight', () => {
    const sh = shift('20:00', '08:00', 60);
    const list: MarkLike[] = [
      { type: 'IN', at: at(D, '20:00') },
      { type: 'BREAK_START', at: at(nextDay(D), '01:00') },
      { type: 'BREAK_END', at: at(nextDay(D), '02:00') },
      { type: 'OUT', at: at(nextDay(D), '08:00') },
    ];
    const s = day({ shift: sh, marks: list });
    expect(s.workedMinutes).toBe(660);
    expect(s.nightMinutes).toBe(420); // 22–01 (3h) + 02–06 (4h)
    expect(nightMinutes([{ from: at(D, '05:00'), to: at(D, '07:00') }], TZ)).toBe(60);
    const grouped = groupMarksByDay(list, TZ);
    expect(grouped.get(D)).toHaveLength(4);
    expect(grouped.has(nextDay(D))).toBe(false);
    const cell = t13Cell(s, { today: '2026-06-30', absenceKind: null, hasShift: true, publicHoliday: false, weekendOrOff: false });
    expect(cell.codes).toContain('Н');
    expect(cell.codes).not.toContain('С'); // planned 12h − 1h break = 11h = worked
  });

  it('derives statuses for missing marks', () => {
    expect(day({ marks: [] }).dayStatus).toBe('NO_MARKS');
    const noOut = day({ marks: marks(D, ['IN', '10:00']) });
    expect(noOut.dayStatus).toBe('NO_OUT');
    expect(noOut.workedMinutes).toBe(0);
    expect(noOut.isDeviation).toBe(true);
    expect(day({ shift: null }).dayStatus).toBe('DAY_OFF');
    expect(day({ absenceKind: 'SICK' }).dayStatus).toBe('ABSENT');
    // Today: before start → NOT_STARTED; live lateness after start; live timer while on shift.
    const today = { today: D };
    expect(day({ ...today, now: at(D, '09:00') }).dayStatus).toBe('NOT_STARTED');
    const lateNow = day({ ...today, now: at(D, '11:30') });
    expect(lateNow.dayStatus).toBe('NO_MARKS');
    expect(lateNow.lateMinutes).toBe(90);
    const live = day({ ...today, now: at(D, '12:00'), marks: marks(D, ['IN', '10:00']) });
    expect(live.dayStatus).toBe('ON_SHIFT');
    expect(live.workedMinutes).toBe(120);
    expect(day({ ...today, now: at(D, '13:30'), marks: marks(D, ['IN', '10:00'], ['BREAK_START', '13:00']) }).dayStatus).toBe('ON_BREAK');
    expect(day({ ...today, now: at(D, '20:00'), marks: marks(D, ['IN', '10:00']) }).dayStatus).toBe('NO_OUT');
  });

  it('builds board timeline segments with overtime after the planned end', () => {
    const s = day({ marks: marks(D, ['IN', '10:00'], ['BREAK_START', '13:00'], ['BREAK_END', '14:00'], ['OUT', '20:00']) });
    const seg = boardSegments(s, shift());
    expect(seg.map((x) => x.kind)).toEqual(['work', 'break', 'work', 'overtime']);
    expect(seg[3]!.from).toBe(at(D, '19:00').toISOString());
  });

  it('maps T-13 codes for absences, missing days and weekends', () => {
    const base = { today: '2026-06-30', hasShift: true, publicHoliday: false, weekendOrOff: false };
    const empty = day({ marks: [] });
    expect(t13Cell(empty, { ...base, absenceKind: 'VACATION' }).codes).toEqual(['О']);
    expect(t13Cell(empty, { ...base, absenceKind: 'UNPAID' }).codes).toEqual(['БС']);
    expect(t13Cell(empty, { ...base, absenceKind: 'SICK' }).codes).toEqual(['Б']);
    expect(t13Cell(empty, { ...base, absenceKind: 'BUSINESS_TRIP' }).codes).toEqual(['К']);
    const nn = t13Cell(empty, { ...base, absenceKind: null });
    expect(nn).toMatchObject({ hours: 0, codes: ['НН'], deviation: true });
    const off = day({ shift: null });
    expect(t13Cell(off, { ...base, hasShift: false, absenceKind: null, weekendOrOff: true }).codes).toEqual(['В']);
    expect(t13Cell(off, { ...base, hasShift: false, absenceKind: null, publicHoliday: true }).codes).toEqual(['П']);
    const ot = day({ marks: marks(D, ['IN', '10:00'], ['BREAK_START', '13:00'], ['BREAK_END', '14:00'], ['OUT', '21:00']) });
    expect(t13Cell(ot, { ...base, absenceKind: null })).toMatchObject({ hours: 10, codes: ['Я', 'С'], deviation: true });
  });

  it('validates mark sequences', () => {
    expect(allowedNextMarks(null)).toEqual(['IN']);
    expect(allowedNextMarks('IN')).toEqual(['BREAK_START', 'OUT']);
    expect(allowedNextMarks('BREAK_START')).toEqual(['BREAK_END']);
    expect(allowedNextMarks('BREAK_END')).toEqual(['BREAK_START', 'OUT']);
    const now = at(D, '12:00');
    expect(currentSessionLast(marks(D, ['IN', '10:00']), now)).toBe('IN');
    expect(currentSessionLast(marks(D, ['IN', '10:00'], ['OUT', '11:00']), now)).toBeNull();
    // A forgotten OUT from more than 20 h ago does not block a new IN.
    expect(currentSessionLast([{ type: 'IN', at: at('2026-06-20', '10:00') }], now)).toBeNull();
    const iv = buildIntervals(marks(D, ['IN', '10:00'], ['IN', '10:30'], ['OUT', '12:00'], ['OUT', '12:30']), null);
    expect(iv.intervals).toHaveLength(1);
  });

  it('checks geofence distance with capped accuracy', () => {
    const d = haversineM(51.0906, 71.4183, 51.0956, 71.4183);
    expect(Math.round(d)).toBeGreaterThan(550);
    expect(Math.round(d)).toBeLessThan(560);
    expect(insideGeofence(240, 250, 0)).toBe(true);
    expect(insideGeofence(300, 250, 60)).toBe(true);
    expect(insideGeofence(5000, 250, 100_000)).toBe(false);
  });

  it('evaluates work patterns', () => {
    expect(patternWorks('5/2', '2026-06-22', 0)).toBe(true);
    expect(patternWorks('5/2', '2026-06-27', 5)).toBe(false);
    expect([0, 1, 2, 3, 4, 5].map((i) => patternWorks('2/2', D, i))).toEqual([true, true, false, false, true, true]);
    expect([0, 1, 2].map((i) => patternWorks('custom', D, i, [true, false]))).toEqual([true, false, true]);
  });
});
