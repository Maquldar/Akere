import { z } from 'zod';
import { dateStr, id, pageQuery, timeStr } from '../validators';

/** Time tracking (API.md §13) and sick leaves / absences (API.md §12). */

export const SHIFT_COLORS = ['green', 'teal', 'blue', 'orange', 'purple', 'gray', 'red'] as const;
export type ShiftColor = (typeof SHIFT_COLORS)[number];
export const TIME_MARK_TYPES = ['IN', 'BREAK_START', 'BREAK_END', 'OUT'] as const;
export type TimeMarkType = (typeof TIME_MARK_TYPES)[number];
export const ABSENCE_KINDS = ['VACATION', 'UNPAID', 'SICK', 'BUSINESS_TRIP', 'OTHER'] as const;
export type AbsenceKind = (typeof ABSENCE_KINDS)[number];
export const TIME_REQUEST_KINDS = ['CORRECTION', 'DAY_OFF_WORK', 'SUBSTITUTION'] as const;
export type TimeRequestKind = (typeof TIME_REQUEST_KINDS)[number];
export const APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
export const DAY_STATUSES = ['NOT_STARTED', 'ON_SHIFT', 'ON_BREAK', 'FINISHED', 'NO_MARKS', 'NO_OUT', 'DAY_OFF', 'ABSENT'] as const;
export type DayStatus = (typeof DAY_STATUSES)[number];
export const BOARD_STATUSES = ['NORMAL', 'LATE', 'NO_OUT', 'NO_MARKS', 'UNDERWORK', 'OVERTIME', 'ON_SHIFT', 'NOT_STARTED', 'ABSENT', 'DAY_OFF'] as const;
export type BoardStatus = (typeof BOARD_STATUSES)[number];
export const T13_CODES = ['Я', 'В', 'К', 'Б', 'О', 'БС', 'НН', 'РВ', 'Н', 'С', 'П'] as const;
export type T13Code = (typeof T13_CODES)[number];

const decision = z.enum(['APPROVE', 'REJECT']);
const reason = z.string().trim().min(1).max(1000);

// ── Inputs ──
export const ShiftTemplateInput = z.object({
  name: z.string().trim().min(1).max(120),
  startTime: timeStr,
  endTime: timeStr,
  breakMinutes: z.number().int().min(0).max(240).default(60),
  color: z.enum(SHIFT_COLORS).default('green'),
  locationId: id.nullish(),
});
export const ShiftTemplateUpdate = ShiftTemplateInput.partial().extend({ isActive: z.boolean().optional() });

export const ShiftInput = z.object({
  employeeId: id.nullable(),
  date: dateStr,
  templateId: id.nullish(),
  startTime: timeStr.optional(),
  endTime: timeStr.optional(),
  breakMinutes: z.number().int().min(0).max(240).optional(),
  title: z.string().trim().min(1).max(120).optional(),
  color: z.enum(SHIFT_COLORS).optional(),
  locationId: id.nullish(),
});
export const ShiftUpdate = ShiftInput.partial();

export const ShiftPatternInput = z.object({
  employeeIds: z.array(id).min(1).max(500),
  templateId: id,
  pattern: z.enum(['5/2', '2/2', 'custom']),
  cycle: z.array(z.boolean()).min(1).max(60).optional(),
  from: dateStr,
  to: dateStr,
  startOffset: z.number().int().min(0).max(365).default(0),
  skipHolidays: z.boolean().default(true),
  replace: z.boolean().default(false),
});
export const CopyWeekInput = z.object({ fromWeekStart: dateStr, toWeekStart: dateStr, employeeIds: z.array(id).max(500).optional() });
export const PublishShiftsInput = z.object({ from: dateStr, to: dateStr, employeeIds: z.array(id).max(500).optional() });
export const ClaimDecisionInput = z.object({ decision });

export const TimeRequestInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('CORRECTION'), date: dateStr, in: timeStr.optional(), out: timeStr.optional(), reason }),
  z.object({ kind: z.literal('DAY_OFF_WORK'), date: dateStr, start: timeStr, end: timeStr, reason }),
  z.object({ kind: z.literal('SUBSTITUTION'), shiftId: id, substituteEmployeeId: id, reason }),
]);
export const TimeRequestDecisionInput = z.object({ decision, comment: z.string().trim().max(1000).optional() });
export const T13ConfirmInput = z.object({ year: z.number().int().min(2000).max(2100), month: z.number().int().min(1).max(12) });

// ── Queries ──
export const ScheduleQuery = z.object({
  from: dateStr, to: dateStr, departmentId: id.optional(), q: z.string().trim().max(100).optional(),
  scope: z.enum(['team', 'managed']).default('team'),
});
export const MarksQuery = pageQuery.extend({ employeeId: id.optional(), date: dateStr.optional(), from: dateStr.optional(), to: dateStr.optional() });
export const TimeRequestsQuery = pageQuery.extend({
  scope: z.enum(['mine', 'managed']).default('mine'), status: z.enum(APPROVAL_STATUSES).optional(), kind: z.enum(TIME_REQUEST_KINDS).optional(),
});
export const BoardQuery = z.object({ date: dateStr.optional(), departmentId: id.optional(), q: z.string().trim().max(100).optional(), status: z.enum(BOARD_STATUSES).optional() });
export const T13Query = z.object({
  year: z.coerce.number().int().min(2000).max(2100), month: z.coerce.number().int().min(1).max(12),
  legalEntityId: id.optional(), departmentId: id.optional(), q: z.string().trim().max(100).optional(),
});
export const WeekQuery = z.object({ date: dateStr.optional() });

// ── Sick leaves / absences (§12) ──
export const SickLeaveInput = z.object({
  employeeId: id,
  number: z.string().trim().min(1).max(64),
  startDate: dateStr,
  endDate: dateStr,
  source: z.enum(['MANUAL', 'ELECTRONIC']).default('MANUAL'),
  fileId: id.nullish(),
  note: z.string().trim().max(1000).nullish(),
});
export const SickLeaveUpdate = SickLeaveInput.partial();
export const SickLeavesQuery = pageQuery.extend({ employeeId: id.optional(), from: dateStr.optional(), to: dateStr.optional() });
export const AbsencesQuery = z.object({
  from: dateStr.optional(), to: dateStr.optional(), employeeId: id.optional(), departmentId: id.optional(), kind: z.enum(ABSENCE_KINDS).optional(),
});

// ── Views (response types) ──
type Ref = { id: string; fullName: string; shortName: string; position: string | null; department: string | null };
type EmpRef = Ref & { employeeId: string };
type FileRefT = { id: string; filename: string; mime: string; size: number; url: string; createdAt: string };
export type ShiftTemplateView = { id: string; name: string; startTime: string; endTime: string; breakMinutes: number; color: ShiftColor; location: { id: string; name: string } | null; isActive: boolean };
export type ShiftView = {
  id: string; employeeId: string | null; date: string; startAt: string; endAt: string; breakMinutes: number; title: string; color: ShiftColor;
  status: 'DRAFT' | 'PUBLISHED'; templateId: string | null; location: { id: string; name: string } | null;
  claims: { id: string; employee: Ref; status: ApprovalStatus }[];
};
export type AbsenceView = { id: string; employeeId: string; kind: AbsenceKind; startDate: string; endDate: string; note: string | null; source: 'REQUEST' | 'SICK_LEAVE' | 'MANUAL' };
export type SickLeaveView = { id: string; employee: Ref; number: string; startDate: string; endDate: string; days: number; source: 'MANUAL' | 'ELECTRONIC'; file: FileRefT | null; note: string | null; createdAt: string };
export type ScheduleView = {
  from: string; to: string;
  rows: { employee: EmpRef; plannedHours: number; targetHours: number; shifts: ShiftView[]; absences: AbsenceView[] }[];
  openShifts: ShiftView[]; holidays: { date: string; name: string; kind: string }[]; hasDrafts: boolean;
};
export type TimeMarkView = {
  id: string; employee: Ref; type: TimeMarkType; at: string; distanceM: number | null; verification: 'PASSED' | 'FAILED' | 'SKIPPED';
  verificationNote: string | null; selfieUrl: string | null; source: 'SELF' | 'CORRECTION';
};
export type TimeRequestView = {
  id: string; kind: TimeRequestKind; employee: Ref; date: string; data: Record<string, unknown>; status: ApprovalStatus;
  decidedBy: Ref | null; decidedAt: string | null; comment: string | null; createdAt: string;
};
export type WorkLocationView = { id: string; name: string; address: string | null; lat: number; lng: number; radiusM: number };
export type MyDay = {
  date: string; shift: ShiftView | null; status: DayStatus; lateMinutes: number; earlyLeaveMinutes: number; workedMinutes: number; breakMinutes: number;
  marks: TimeMarkView[]; remainingMinutes: number | null;
  settings: { requireSelfie: boolean; requireGeofence: boolean; location: WorkLocationView | null };
  upcoming: { date: string; shift: ShiftView | null; absence: AbsenceView | null; holiday: string | null }[];
  requests: TimeRequestView[]; openShifts: ShiftView[];
};
export type MyWeek = {
  from: string; to: string; workedMinutes: number; plannedMinutes: number;
  days: { date: string; plannedMinutes: number; workedMinutes: number; kind: 'WORK' | 'OFF' | 'ABSENCE' | 'HOLIDAY'; absenceKind: AbsenceKind | null }[];
};
export type MarkResult = { mark: TimeMarkView; day: MyDay };
export type TodayBoard = {
  date: string;
  kpi: { onShiftNow: number; scheduledToday: number; needAttention: number; noMarks: number; overtimeMinutes: number; closedShifts: number; totalShifts: number; factMinutes: number; deltaToPlanMinutes: number };
  rows: {
    employee: EmpRef; shift: ShiftView | null; status: BoardStatus; inAt: string | null; outAt: string | null;
    segments: { from: string; to: string; kind: 'work' | 'break' | 'overtime' }[]; workedMinutes: number; plannedMinutes: number; deviationMinutes: number;
  }[];
};
export type T13Sheet = {
  year: number; month: number; days: { day: number; weekday: number; isHoliday: boolean; isWeekend: boolean }[];
  rows: {
    employee: EmpRef; planHours: number; factHours: number; normHours: number; overtime15: number; overtime2: number; deviations: number;
    cells: { day: number; hours: number | null; codes: T13Code[]; deviation: boolean; note: string | null }[];
  }[];
  totals: { planHours: number; factHours: number; normHours: number; overtime15: number; overtime2: number; perDay: number[] };
  deviationsTotal: number; confirmation: { confirmed: number; total: number; mine: boolean | null };
};
