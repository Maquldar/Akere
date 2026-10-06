import type { AbsenceKind, BoardStatus, DayStatus, T13Code, TimeMarkType } from '@akere/shared';
import { isoWeekdayOf, localDateStr, tzOffsetMinutes } from '../../lib/calendar';

/**
 * Pure time-tracking computations (API.md §13 "Computation rules"). No DB access here, so every
 * rule is unit-tested in isolation; the routes load data and call these.
 */

export const LATE_GRACE_MIN = 5;
export const DEVIATION_MIN = 15;
export const OT15_CAP_MIN = 120; // first 2 h of daily overtime at 1.5x (Labor Code RK art. 108)
export const NIGHT_FROM_MIN = 22 * 60;
export const NIGHT_TO_MIN = 6 * 60;
/** Max gap after which a BREAK/OUT no longer belongs to an open IN (forgotten OUT). */
export const SESSION_MAX_MIN = 20 * 60;
export const DAY_OFF_WORK_TITLE = 'Работа в выходной';
/** Scheduled break is deducted automatically when none was marked and at least this much work remains. */
export const AUTO_BREAK_MIN_WORK = 4 * 60;

export type MarkLike = { type: TimeMarkType; at: Date };
export type ShiftLike = { startAt: Date; endAt: Date; breakMinutes: number; title?: string | null };
export type Interval = { from: Date; to: Date; kind: 'work' | 'break'; open: boolean };

const minutes = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 60_000;
const sumMinutes = (xs: Interval[], kind: Interval['kind']) => xs.filter((x) => x.kind === kind).reduce((s, x) => s + minutes(x.from, x.to), 0);

// ───────────── Mark sequence ─────────────

/** Allowed next mark types given the last mark of the current session (null = no open session). */
export function allowedNextMarks(last: TimeMarkType | null): TimeMarkType[] {
  switch (last) {
    case 'IN':
      return ['BREAK_START', 'OUT'];
    case 'BREAK_START':
      return ['BREAK_END'];
    case 'BREAK_END':
      return ['BREAK_START', 'OUT'];
    default:
      return ['IN'];
  }
}

/** The mark that defines the current state: the latest mark if the session is still open (recent). */
export function currentSessionLast(marks: MarkLike[], now: Date): TimeMarkType | null {
  const sorted = [...marks].sort((a, b) => a.at.getTime() - b.at.getTime());
  const last = sorted.at(-1);
  if (!last || last.type === 'OUT') return null;
  // Find the IN that opened this session; stale sessions (forgotten OUT) are treated as closed.
  const lastIn = [...sorted].reverse().find((m) => m.type === 'IN');
  if (!lastIn || minutes(lastIn.at, now) > SESSION_MAX_MIN) return null;
  return last.type;
}

// ───────────── Intervals ─────────────

/**
 * Turns a day's marks into work/break intervals. Tolerant of bad sequences (duplicate IN,
 * orphan OUT are ignored). An open interval is closed at `closeAt` (live view) or dropped.
 */
export function buildIntervals(marks: MarkLike[], closeAt: Date | null) {
  const sorted = [...marks].sort((a, b) => a.at.getTime() - b.at.getTime());
  const intervals: Interval[] = [];
  let state: 'out' | 'work' | 'break' = 'out';
  let openFrom: Date | null = null;
  let inAt: Date | null = null;
  let outAt: Date | null = null;
  const close = (to: Date, kind: Interval['kind']) => {
    if (openFrom && to > openFrom) intervals.push({ from: openFrom, to, kind, open: false });
  };
  for (const m of sorted) {
    if (m.type === 'IN' && state === 'out') {
      state = 'work';
      openFrom = m.at;
      inAt ??= m.at;
      outAt = null;
    } else if (m.type === 'BREAK_START' && state === 'work') {
      close(m.at, 'work');
      state = 'break';
      openFrom = m.at;
    } else if (m.type === 'BREAK_END' && state === 'break') {
      close(m.at, 'break');
      state = 'work';
      openFrom = m.at;
    } else if (m.type === 'OUT' && state !== 'out') {
      close(m.at, state === 'work' ? 'work' : 'break');
      state = 'out';
      openFrom = null;
      outAt = m.at;
    }
  }
  if (state !== 'out' && openFrom && closeAt && closeAt > openFrom) {
    intervals.push({ from: openFrom, to: closeAt, kind: state === 'work' ? 'work' : 'break', open: true });
  }
  return { intervals, state, inAt, outAt: state === 'out' ? outAt : null };
}

/**
 * Assigns marks to the local day of the IN that opened their session, so a night shift that
 * crosses midnight belongs to its start date. Orphan marks fall on their own local date.
 */
export function groupMarksByDay<M extends MarkLike>(marks: M[], tz: string): Map<string, M[]> {
  const out = new Map<string, M[]>();
  const sorted = [...marks].sort((a, b) => a.at.getTime() - b.at.getTime());
  let session: { day: string; startedAt: Date } | null = null;
  const push = (day: string, m: M) => (out.get(day) ?? out.set(day, []).get(day)!).push(m);
  for (const m of sorted) {
    if (m.type === 'IN') {
      session = { day: localDateStr(m.at, tz), startedAt: m.at };
      push(session.day, m);
    } else if (session && minutes(session.startedAt, m.at) <= SESSION_MAX_MIN) {
      push(session.day, m);
      if (m.type === 'OUT') session = null;
    } else {
      session = null;
      push(localDateStr(m.at, tz), m);
    }
  }
  return out;
}

export const plannedMinutesOf = (s: ShiftLike | null) => (s ? Math.max(0, Math.round(minutes(s.startAt, s.endAt)) - s.breakMinutes) : 0);

/** Minutes of the intervals that fall into 22:00–06:00 local time. */
export function nightMinutes(intervals: { from: Date; to: Date }[], tz: string): number {
  let total = 0;
  for (const iv of intervals) {
    const off = tzOffsetMinutes(tz, iv.from) * 60_000;
    const a = iv.from.getTime() + off; // "local epoch" ms
    const b = iv.to.getTime() + off;
    const dayMs = 86_400_000;
    for (let d = Math.floor(a / dayMs) - 1; d * dayMs < b; d++) {
      const ns = d * dayMs + NIGHT_FROM_MIN * 60_000;
      const ne = (d + 1) * dayMs + NIGHT_TO_MIN * 60_000;
      const s = Math.max(a, ns);
      const e = Math.min(b, ne);
      if (e > s) total += (e - s) / 60_000;
    }
  }
  return Math.round(total);
}

/** Split overtime into 1.5x / 2x parts. Off-day or holiday work is paid 2x entirely. */
export function splitOvertime(overtimeMin: number, offDay: boolean) {
  if (overtimeMin <= 0) return { ot15: 0, ot2: 0 };
  if (offDay) return { ot15: 0, ot2: overtimeMin };
  return { ot15: Math.min(overtimeMin, OT15_CAP_MIN), ot2: Math.max(0, overtimeMin - OT15_CAP_MIN) };
}

// ───────────── Day summary ─────────────

export type DayInput = {
  date: string;
  today: string;
  now: Date;
  tz: string;
  shift: ShiftLike | null;
  marks: MarkLike[];
  absenceKind: AbsenceKind | null;
  /** Public holiday / carried-over day off from the production calendar. */
  publicHoliday: boolean;
};

export type DaySummary = {
  date: string;
  intervals: Interval[];
  inAt: Date | null;
  outAt: Date | null;
  open: boolean;
  workedMinutes: number;
  breakMinutes: number;
  plannedMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  overtime15Minutes: number;
  overtime2Minutes: number;
  nightMinutes: number;
  offDayWork: boolean;
  dayStatus: DayStatus;
  boardStatus: BoardStatus;
  deviationMinutes: number;
  isDeviation: boolean;
};

export function summarizeDay(i: DayInput): DaySummary {
  const { shift, now } = i;
  const isToday = i.date === i.today;
  const isPast = i.date < i.today;
  const planned = plannedMinutesOf(shift);
  const { intervals, state, inAt, outAt } = buildIntervals(i.marks, isToday ? now : null);
  const open = state !== 'out';
  const gross = Math.round(sumMinutes(intervals, 'work'));
  let breaks = Math.round(sumMinutes(intervals, 'break'));
  // No break marked on a closed day: the scheduled break is assumed taken (auto-deduction),
  // as long as the remaining time still covers 4 h of work.
  let autoBreak = 0;
  if (!open && breaks === 0 && shift && shift.breakMinutes > 0 && gross >= AUTO_BREAK_MIN_WORK + shift.breakMinutes) autoBreak = shift.breakMinutes;
  breaks += autoBreak;
  const worked = gross - autoBreak;
  const offDayWork = !shift || shift.title === DAY_OFF_WORK_TITLE || i.publicHoliday;

  let late = 0;
  if (shift && inAt) {
    const d = minutes(shift.startAt, inAt);
    late = d > LATE_GRACE_MIN ? Math.round(d) : 0;
  } else if (shift && !inAt && isToday && now < shift.endAt) {
    const d = minutes(shift.startAt, now); // live lateness before the first mark
    late = d > LATE_GRACE_MIN ? Math.round(d) : 0;
  }
  let early = 0;
  if (shift && outAt && !open) {
    const d = minutes(outAt, shift.endAt);
    early = d > LATE_GRACE_MIN ? Math.round(d) : 0;
  }

  let overtime = 0;
  if (worked > 0) {
    if (offDayWork) overtime = worked;
    else if (worked - planned > DEVIATION_MIN) overtime = worked - planned;
  }
  const { ot15, ot2 } = splitOvertime(overtime, offDayWork);
  const night = nightMinutes(intervals.filter((x) => x.kind === 'work'), i.tz);

  // Day status (employee-facing).
  let dayStatus: DayStatus;
  const hasSession = !!inAt;
  if (!hasSession) {
    if (i.absenceKind) dayStatus = 'ABSENT';
    else if (!shift) dayStatus = 'DAY_OFF';
    else if (i.date > i.today) dayStatus = 'NOT_STARTED';
    else if (isToday && now.getTime() <= shift.startAt.getTime() + LATE_GRACE_MIN * 60_000) dayStatus = 'NOT_STARTED';
    else dayStatus = 'NO_MARKS';
  } else if (open) {
    const overdue = isPast || (isToday && shift && now.getTime() > shift.endAt.getTime() + DEVIATION_MIN * 60_000);
    dayStatus = overdue ? 'NO_OUT' : state === 'break' ? 'ON_BREAK' : 'ON_SHIFT';
  } else dayStatus = 'FINISHED';

  // Board status (manager-facing).
  let boardStatus: BoardStatus;
  switch (dayStatus) {
    case 'ABSENT':
    case 'DAY_OFF':
    case 'NOT_STARTED':
    case 'NO_MARKS':
    case 'NO_OUT':
      boardStatus = dayStatus;
      break;
    case 'ON_SHIFT':
    case 'ON_BREAK':
      boardStatus = late > 0 ? 'LATE' : 'ON_SHIFT';
      break;
    default:
      if (!offDayWork && planned - worked > DEVIATION_MIN) boardStatus = 'UNDERWORK';
      else if (late > 0) boardStatus = 'LATE';
      else if (overtime > 0) boardStatus = 'OVERTIME';
      else boardStatus = 'NORMAL';
  }

  let deviationMinutes = 0;
  if (dayStatus === 'FINISHED') deviationMinutes = worked - planned;
  else if (dayStatus === 'NO_MARKS' && isPast) deviationMinutes = -planned;
  const isDeviation =
    (dayStatus === 'NO_MARKS' && isPast) ||
    dayStatus === 'NO_OUT' ||
    (dayStatus === 'FINISHED' && (boardStatus === 'LATE' || boardStatus === 'UNDERWORK' || Math.abs(worked - planned) > DEVIATION_MIN));

  return {
    date: i.date, intervals, inAt, outAt, open, workedMinutes: worked, breakMinutes: breaks, plannedMinutes: planned,
    lateMinutes: late, earlyLeaveMinutes: early, overtimeMinutes: overtime, overtime15Minutes: ot15, overtime2Minutes: ot2,
    nightMinutes: night, offDayWork: offDayWork && worked > 0, dayStatus, boardStatus, deviationMinutes, isDeviation,
  };
}

/** Timeline segments for the board: work beyond the planned end (or any off-day work) is overtime. */
export function boardSegments(s: DaySummary, shift: ShiftLike | null) {
  const out: { from: string; to: string; kind: 'work' | 'break' | 'overtime' }[] = [];
  for (const iv of s.intervals) {
    if (iv.kind === 'break') {
      out.push({ from: iv.from.toISOString(), to: iv.to.toISOString(), kind: 'break' });
    } else if (!shift || s.offDayWork) {
      out.push({ from: iv.from.toISOString(), to: iv.to.toISOString(), kind: s.overtimeMinutes > 0 ? 'overtime' : 'work' });
    } else if (s.overtimeMinutes > 0 && iv.to > shift.endAt) {
      const split = iv.from > shift.endAt ? iv.from : shift.endAt;
      if (split > iv.from) out.push({ from: iv.from.toISOString(), to: split.toISOString(), kind: 'work' });
      out.push({ from: split.toISOString(), to: iv.to.toISOString(), kind: 'overtime' });
    } else {
      out.push({ from: iv.from.toISOString(), to: iv.to.toISOString(), kind: 'work' });
    }
  }
  return out;
}

// ───────────── T-13 ─────────────

export const ABSENCE_T13: Record<AbsenceKind, T13Code | null> = { VACATION: 'О', UNPAID: 'БС', SICK: 'Б', BUSINESS_TRIP: 'К', OTHER: null };
const ABSENCE_LABEL: Record<AbsenceKind, string> = { VACATION: 'Отпуск', UNPAID: 'Отпуск без сохранения', SICK: 'Больничный', BUSINESS_TRIP: 'Командировка', OTHER: 'Отсутствие' };

export const round1 = (n: number) => Math.round(n * 10) / 10;
export const hours1 = (min: number) => round1(min / 60);

export type T13Cell = { hours: number | null; codes: T13Code[]; deviation: boolean; note: string | null };

export function t13Cell(s: DaySummary, ctx: { today: string; absenceKind: AbsenceKind | null; hasShift: boolean; publicHoliday: boolean; weekendOrOff: boolean }): T13Cell {
  const isPast = s.date < ctx.today;
  if (s.inAt) {
    const codes: T13Code[] = [s.offDayWork ? 'РВ' : 'Я'];
    if (s.overtimeMinutes > 0 && !s.offDayWork) codes.push('С');
    if (s.nightMinutes > 0) codes.push('Н');
    const notes: string[] = [];
    if (s.dayStatus === 'NO_OUT') notes.push('Нет отметки ухода');
    if (s.lateMinutes > 0) notes.push(`Опоздание ${s.lateMinutes} мин`);
    if (s.earlyLeaveMinutes > 0) notes.push(`Ранний уход ${s.earlyLeaveMinutes} мин`);
    if (s.overtimeMinutes > 0) notes.push(`Переработка ${s.overtimeMinutes} мин`);
    if (s.nightMinutes > 0) notes.push(`Ночные ${s.nightMinutes} мин`);
    return { hours: hours1(s.workedMinutes), codes, deviation: s.isDeviation, note: notes.join('; ') || null };
  }
  if (ctx.absenceKind) {
    const code = ABSENCE_T13[ctx.absenceKind];
    return { hours: null, codes: code ? [code] : [], deviation: false, note: ABSENCE_LABEL[ctx.absenceKind] };
  }
  if (ctx.hasShift) {
    if (isPast && s.dayStatus === 'NO_MARKS') return { hours: 0, codes: ['НН'], deviation: true, note: 'Нет отметок в плановый день' };
    return { hours: null, codes: [], deviation: false, note: null };
  }
  if (ctx.publicHoliday) return { hours: null, codes: ['П'], deviation: false, note: 'Нерабочий праздничный день' };
  return { hours: null, codes: ['В'], deviation: false, note: ctx.weekendOrOff ? 'Выходной день' : null };
}

// ───────────── Geofence ─────────────

/** Great-circle distance in metres. */
export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** GPS accuracy credited on top of the radius is capped so a spoofed huge accuracy can't bypass the fence. */
export const MAX_ACCURACY_CREDIT_M = 150;
export function insideGeofence(distanceM: number, radiusM: number, accuracyM: number | null | undefined) {
  return distanceM <= radiusM + Math.min(Math.max(accuracyM ?? 0, 0), MAX_ACCURACY_CREDIT_M);
}

// ───────────── Patterns ─────────────

/** Whether a pattern day is a working day. `index` = days since range start + startOffset. */
export function patternWorks(pattern: '5/2' | '2/2' | 'custom', date: string, index: number, cycle?: boolean[]): boolean {
  if (pattern === '5/2') return isoWeekdayOf(date) <= 5;
  if (pattern === '2/2') return index % 4 < 2;
  if (!cycle?.length) return false;
  return cycle[index % cycle.length]!;
}

