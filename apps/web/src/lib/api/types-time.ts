/**
 * Time tracking (API.md §13) and sick leaves / absences (API.md §12) shapes.
 * Names mirror packages/shared/src/schemas/time.ts.
 */
import type { DateStr, FileRef, Option, PageQuery, UserRef } from './types';

export const SHIFT_COLORS = ['green', 'teal', 'blue', 'orange', 'purple', 'gray', 'red'] as const;
export type ShiftColor = (typeof SHIFT_COLORS)[number];
export type TimeMarkType = 'IN' | 'BREAK_START' | 'BREAK_END' | 'OUT';
export const ABSENCE_KINDS = ['VACATION', 'UNPAID', 'SICK', 'BUSINESS_TRIP', 'OTHER'] as const;
export type AbsenceKind = (typeof ABSENCE_KINDS)[number];
export const TIME_REQUEST_KINDS = ['CORRECTION', 'DAY_OFF_WORK', 'SUBSTITUTION'] as const;
export type TimeRequestKind = (typeof TIME_REQUEST_KINDS)[number];
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type DayStatus = 'NOT_STARTED' | 'ON_SHIFT' | 'ON_BREAK' | 'FINISHED' | 'NO_MARKS' | 'NO_OUT' | 'DAY_OFF' | 'ABSENT';
export const BOARD_STATUSES = ['NORMAL', 'LATE', 'NO_OUT', 'NO_MARKS', 'UNDERWORK', 'OVERTIME', 'ON_SHIFT', 'NOT_STARTED', 'ABSENT', 'DAY_OFF'] as const;
export type BoardStatus = (typeof BOARD_STATUSES)[number];
export type T13Code = 'Я' | 'В' | 'К' | 'Б' | 'О' | 'БС' | 'НН' | 'РВ' | 'Н' | 'С' | 'П';

/** Time endpoints return employee refs with the Employee id next to the user id. */
export type EmpRef = UserRef & { employeeId: string };

export type ShiftTemplateView = {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  color: ShiftColor;
  location: Option | null;
  isActive: boolean;
};
export type ShiftTemplateInput = {
  name: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  color: ShiftColor;
  locationId?: string | null;
};

export type ShiftClaim = { id: string; employee: UserRef; status: ApprovalStatus };
export type ShiftView = {
  id: string;
  employeeId: string | null;
  date: DateStr;
  startAt: string;
  endAt: string;
  breakMinutes: number;
  title: string;
  color: ShiftColor;
  status: 'DRAFT' | 'PUBLISHED';
  templateId: string | null;
  location: Option | null;
  claims: ShiftClaim[];
};
export type ShiftInput = {
  employeeId: string | null;
  date: DateStr;
  templateId?: string | null;
  startTime?: string;
  endTime?: string;
  breakMinutes?: number;
  title?: string;
  color?: ShiftColor;
  locationId?: string | null;
};

export type AbsenceView = {
  id: string;
  employeeId: string;
  kind: AbsenceKind;
  startDate: DateStr;
  endDate: DateStr;
  note: string | null;
  source: 'REQUEST' | 'SICK_LEAVE' | 'MANUAL';
};

export type Holiday = { date: DateStr; name: string; kind: string };
export type ScheduleRow = { employee: EmpRef; plannedHours: number; targetHours: number; shifts: ShiftView[]; absences: AbsenceView[] };
export type ScheduleView = { from: DateStr; to: DateStr; rows: ScheduleRow[]; openShifts: ShiftView[]; holidays: Holiday[]; hasDrafts: boolean };
export type ScheduleQuery = { from: DateStr; to: DateStr; departmentId?: string; q?: string; scope: 'team' | 'managed' };

export type TimeMarkView = {
  id: string;
  employee: UserRef;
  type: TimeMarkType;
  at: string;
  distanceM: number | null;
  verification: 'PASSED' | 'FAILED' | 'SKIPPED';
  verificationNote: string | null;
  selfieUrl: string | null;
  source: 'SELF' | 'CORRECTION';
};

export type TimeRequestView = {
  id: string;
  kind: TimeRequestKind;
  employee: UserRef;
  date: DateStr;
  data: Record<string, unknown>;
  status: ApprovalStatus;
  decidedBy: UserRef | null;
  decidedAt: string | null;
  comment: string | null;
  createdAt: string;
};
export type TimeRequestInput =
  | { kind: 'CORRECTION'; date: DateStr; in?: string; out?: string; reason: string }
  | { kind: 'DAY_OFF_WORK'; date: DateStr; start: string; end: string; reason: string }
  | { kind: 'SUBSTITUTION'; shiftId: string; substituteEmployeeId: string; reason: string };

export type WorkLocationView = { id: string; name: string; address: string | null; lat: number; lng: number; radiusM: number };

export type UpcomingDay = { date: DateStr; shift: ShiftView | null; absence: AbsenceView | null; holiday: string | null };
export type MyDay = {
  date: DateStr;
  shift: ShiftView | null;
  status: DayStatus;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  workedMinutes: number;
  breakMinutes: number;
  marks: TimeMarkView[];
  remainingMinutes: number | null;
  settings: { requireSelfie: boolean; requireGeofence: boolean; location: WorkLocationView | null };
  upcoming: UpcomingDay[];
  requests: TimeRequestView[];
  openShifts: ShiftView[];
};
export type WeekDayKind = 'WORK' | 'OFF' | 'ABSENCE' | 'HOLIDAY';
export type MyWeek = {
  from: DateStr;
  to: DateStr;
  workedMinutes: number;
  plannedMinutes: number;
  days: { date: DateStr; plannedMinutes: number; workedMinutes: number; kind: WeekDayKind; absenceKind: AbsenceKind | null }[];
};
export type MarkResult = { mark: TimeMarkView; day: MyDay };

export type BoardSegment = { from: string; to: string; kind: 'work' | 'break' | 'overtime' };
export type BoardRow = {
  employee: EmpRef;
  shift: ShiftView | null;
  status: BoardStatus;
  inAt: string | null;
  outAt: string | null;
  segments: BoardSegment[];
  workedMinutes: number;
  plannedMinutes: number;
  deviationMinutes: number;
};
export type TodayBoard = {
  date: DateStr;
  kpi: {
    onShiftNow: number;
    scheduledToday: number;
    needAttention: number;
    noMarks: number;
    overtimeMinutes: number;
    closedShifts: number;
    totalShifts: number;
    factMinutes: number;
    deltaToPlanMinutes: number;
  };
  rows: BoardRow[];
};

export type T13Cell = { day: number; hours: number | null; codes: T13Code[]; deviation: boolean; note: string | null };
export type T13Row = {
  employee: EmpRef;
  planHours: number;
  factHours: number;
  normHours: number;
  overtime15: number;
  overtime2: number;
  deviations: number;
  cells: T13Cell[];
};
export type T13Sheet = {
  year: number;
  month: number;
  days: { day: number; weekday: number; isHoliday: boolean; isWeekend: boolean }[];
  rows: T13Row[];
  totals: { planHours: number; factHours: number; normHours: number; overtime15: number; overtime2: number; perDay: number[] };
  deviationsTotal: number;
  confirmation: { confirmed: number; total: number; mine: boolean | null };
};
export type T13Query = { year: number; month: number; legalEntityId?: string; departmentId?: string; q?: string };

export type MarksQuery = PageQuery & { employeeId?: string; date?: DateStr; from?: DateStr; to?: DateStr };
export type TimeRequestsQuery = PageQuery & { scope: 'mine' | 'managed'; status?: ApprovalStatus; kind?: TimeRequestKind };
export type BoardQuery = { date?: DateStr; departmentId?: string; q?: string; status?: BoardStatus };

// §12 Sick leaves / absences ----------------------------------------------------

export type SickLeaveView = {
  id: string;
  employee: UserRef;
  number: string;
  startDate: DateStr;
  endDate: DateStr;
  days: number;
  source: 'MANUAL' | 'ELECTRONIC';
  file: FileRef | null;
  note: string | null;
  createdAt: string;
};
export type SickLeaveInput = {
  employeeId: string;
  number: string;
  startDate: DateStr;
  endDate: DateStr;
  source: 'MANUAL' | 'ELECTRONIC';
  fileId?: string | null;
  note?: string | null;
};
export type SickLeavesQuery = PageQuery & { employeeId?: string; from?: DateStr; to?: DateStr };
export type AbsencesQuery = { from?: DateStr; to?: DateStr; employeeId?: string; departmentId?: string; kind?: AbsenceKind };

/** `GET /employees/options` item (id = Employee id). */
export type EmployeeOption = UserRef & { userId: string };
