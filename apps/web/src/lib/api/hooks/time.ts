'use client';

import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, buildUrl, baseHeaders } from '../client';
import { toApiError } from '../errors';
import { qk } from '../query-keys';
import { uploadFiles } from '../upload';
import type { Department, Page } from '../types';
import type {
  AbsencesQuery, AbsenceView, BoardQuery, EmployeeOption, MarkResult, MarksQuery, MyDay, MyWeek, ScheduleQuery, ScheduleView,
  ShiftInput, ShiftTemplateInput, ShiftTemplateView, ShiftView, SickLeaveInput, SickLeavesQuery, SickLeaveView, T13Query, T13Sheet,
  TimeMarkType, TimeMarkView, TimeRequestInput, TimeRequestsQuery, TimeRequestView, TodayBoard,
} from '../types-time';

/** Query keys of the time module (kept here so other modules never collide). */
export const tk = {
  all: ['time'] as const,
  today: ['time', 'me', 'today'] as const,
  week: (date?: string) => ['time', 'me', 'week', date ?? 'current'] as const,
  templates: (all: boolean) => ['time', 'templates', all] as const,
  schedule: (q: ScheduleQuery) => ['time', 'schedule', q] as const,
  marks: (q: MarksQuery) => ['time', 'marks', q] as const,
  requests: (q: TimeRequestsQuery) => ['time', 'requests', q] as const,
  board: (q: BoardQuery) => ['time', 'board', q] as const,
  t13: (q: T13Query) => ['time', 't13', q] as const,
  sickLeaves: (q?: SickLeavesQuery) => (q ? (['sick-leaves', q] as const) : (['sick-leaves'] as const)),
  absences: (q?: AbsencesQuery) => (q ? (['absences', q] as const) : (['absences'] as const)),
  departments: ['time', 'departments'] as const,
};

// ── My time ──

export function useMyDay() {
  return useQuery({
    queryKey: tk.today,
    queryFn: ({ signal }) => apiFetch<MyDay>('/time/me/today', { signal }),
    refetchInterval: 60_000,
  });
}

export function useMyWeek(date?: string) {
  return useQuery({
    queryKey: tk.week(date),
    queryFn: ({ signal }) => apiFetch<MyWeek>('/time/me/week', { query: { date }, signal }),
    placeholderData: keepPreviousData,
  });
}

/** Several weeks at once (month view of "Мои часы"). */
export function useMyWeeks(dates: string[]) {
  return useQueries({
    queries: dates.map((date) => ({
      queryKey: tk.week(date),
      queryFn: ({ signal }: { signal: AbortSignal }) => apiFetch<MyWeek>('/time/me/week', { query: { date }, signal }),
    })),
  });
}

export type MarkPayload = { type: TimeMarkType; lat?: number; lng?: number; accuracyM?: number; selfie?: File | null };

export function useCreateMark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ selfie, ...fields }: MarkPayload) =>
      uploadFiles<MarkResult>('/time/marks', selfie ? [selfie] : [], { fileField: 'selfie', fields }),
    onSuccess: (res) => {
      qc.setQueryData(tk.today, res.day);
      void qc.invalidateQueries({ queryKey: ['time', 'me', 'week'] });
      void qc.invalidateQueries({ queryKey: ['time', 'board'] });
    },
  });
}

// ── Templates ──

export function useShiftTemplates(all = false) {
  return useQuery({
    queryKey: tk.templates(all),
    queryFn: ({ signal }) => apiFetch<ShiftTemplateView[]>('/time/shift-templates', { query: { all: all ? 'true' : undefined }, signal }),
    staleTime: 60_000,
  });
}

export function useSaveTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: Partial<ShiftTemplateInput> & { isActive?: boolean } }) =>
      id
        ? apiFetch<ShiftTemplateView>(`/time/shift-templates/${id}`, { method: 'PATCH', body: input })
        : apiFetch<ShiftTemplateView>('/time/shift-templates', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['time', 'templates'] }),
  });
}

export function useDeactivateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/time/shift-templates/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['time', 'templates'] }),
  });
}

// ── Schedule & shifts ──

export function useSchedule(q: ScheduleQuery, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: tk.schedule(q),
    queryFn: ({ signal }) => apiFetch<ScheduleView>('/time/schedule', { query: q, signal }),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

function useInvalidateSchedule() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['time', 'schedule'] });
    void qc.invalidateQueries({ queryKey: tk.today });
  };
}

export function useSaveShift() {
  const invalidate = useInvalidateSchedule();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: Partial<ShiftInput> }) =>
      id
        ? apiFetch<ShiftView>(`/time/shifts/${id}`, { method: 'PATCH', body: input })
        : apiFetch<ShiftView>('/time/shifts', { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

export function useDeleteShift() {
  const invalidate = useInvalidateSchedule();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/time/shifts/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

export type PatternInput = {
  employeeIds: string[];
  templateId: string;
  pattern: '5/2' | '2/2' | 'custom';
  cycle?: boolean[];
  from: string;
  to: string;
  startOffset?: number;
  skipHolidays: boolean;
  replace: boolean;
};

export function useApplyPattern() {
  const invalidate = useInvalidateSchedule();
  return useMutation({
    mutationFn: (input: PatternInput) => apiFetch<{ created: number; skipped: number }>('/time/shifts/pattern', { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

export function useCopyWeek() {
  const invalidate = useInvalidateSchedule();
  return useMutation({
    mutationFn: (input: { fromWeekStart: string; toWeekStart: string; employeeIds?: string[] }) =>
      apiFetch<{ created: number }>('/time/shifts/copy-week', { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

export function usePublishShifts() {
  const invalidate = useInvalidateSchedule();
  return useMutation({
    mutationFn: (input: { from: string; to: string; employeeIds?: string[] }) =>
      apiFetch<{ published: number }>('/time/shifts/publish', { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

export function useClaimShift() {
  const invalidate = useInvalidateSchedule();
  return useMutation({
    mutationFn: (id: string) => apiFetch<ShiftView>(`/time/shifts/${id}/claim`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

export function useDecideClaim() {
  const invalidate = useInvalidateSchedule();
  return useMutation({
    mutationFn: ({ shiftId, claimId, decision }: { shiftId: string; claimId: string; decision: 'APPROVE' | 'REJECT' }) =>
      apiFetch<ShiftView>(`/time/shifts/${shiftId}/claims/${claimId}/decide`, { method: 'POST', body: { decision } }),
    onSuccess: invalidate,
  });
}

// ── Requests ──

export function useTimeRequests(q: TimeRequestsQuery, options: { enabled?: boolean; refetchInterval?: number } = {}) {
  return useQuery({
    queryKey: tk.requests(q),
    queryFn: ({ signal }) => apiFetch<Page<TimeRequestView>>('/time/requests', { query: q, signal }),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
    refetchInterval: options.refetchInterval,
  });
}

export function useCreateTimeRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TimeRequestInput) => apiFetch<TimeRequestView>('/time/requests', { method: 'POST', body: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['time', 'requests'] });
      void qc.invalidateQueries({ queryKey: tk.today });
    },
  });
}

export function useDecideTimeRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision, comment }: { id: string; decision: 'APPROVE' | 'REJECT'; comment?: string }) =>
      apiFetch<TimeRequestView>(`/time/requests/${id}/decide`, { method: 'POST', body: { decision, comment } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['time'] });
      void qc.invalidateQueries({ queryKey: qk.inboxCounts });
    },
  });
}

// ── Timesheet ──

export function useMarks(q: MarksQuery) {
  return useQuery({
    queryKey: tk.marks(q),
    queryFn: ({ signal }) => apiFetch<Page<TimeMarkView>>('/time/marks', { query: q, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useBoard(q: BoardQuery) {
  return useQuery({
    queryKey: tk.board(q),
    queryFn: ({ signal }) => apiFetch<TodayBoard>('/time/board', { query: q, signal }),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
}

export function useT13(q: T13Query) {
  return useQuery({
    queryKey: tk.t13(q),
    queryFn: ({ signal }) => apiFetch<T13Sheet>('/time/t13', { query: q, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useConfirmT13() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { year: number; month: number }) =>
      apiFetch<{ confirmed: number; total: number }>('/time/t13/confirm', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['time', 't13'] }),
  });
}

/** Downloads the T-13 xlsx (cookie session) and saves it under the server-provided name. */
export async function downloadT13(q: Omit<T13Query, 'q'>): Promise<string> {
  const res = await fetch(buildUrl('/time/t13/export', q), { credentials: 'include', headers: baseHeaders('GET') });
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }
    throw toApiError(res.status, body, res.statusText);
  }
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') ?? '';
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  const plain = /filename="?([^";]+)"?/i.exec(cd);
  const name = star ? decodeURIComponent(star[1]!) : (plain?.[1] ?? `T-13_${q.year}-${String(q.month).padStart(2, '0')}.xlsx`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return name;
}

// ── Absences & sick leaves ──

export function useAbsences(q: AbsencesQuery, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: tk.absences(q),
    queryFn: ({ signal }) => apiFetch<AbsenceView[]>('/absences', { query: q, signal }),
    enabled: options.enabled ?? true,
  });
}

export function useSickLeaves(q: SickLeavesQuery, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: tk.sickLeaves(q),
    queryFn: ({ signal }) => apiFetch<Page<SickLeaveView>>('/sick-leaves', { query: q, signal }),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

function useInvalidateSick() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: tk.sickLeaves() });
    void qc.invalidateQueries({ queryKey: tk.absences() });
    void qc.invalidateQueries({ queryKey: ['time'] });
  };
}

export function useSaveSickLeave() {
  const invalidate = useInvalidateSick();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: Partial<SickLeaveInput> }) =>
      id
        ? apiFetch<SickLeaveView>(`/sick-leaves/${id}`, { method: 'PATCH', body: input })
        : apiFetch<SickLeaveView>('/sick-leaves', { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

export function useDeleteSickLeave() {
  const invalidate = useInvalidateSick();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/sick-leaves/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

export function useSyncSickLeaves() {
  const invalidate = useInvalidateSick();
  return useMutation({
    mutationFn: () => apiFetch<{ imported: number }>('/sick-leaves/sync', { method: 'POST' }),
    onSuccess: invalidate,
  });
}

// ── Pickers ──

/** Employee picker (`GET /employees/options`); option value = Employee id. */
export async function searchEmployeeOptions(q: string, signal?: AbortSignal) {
  const rows = await apiFetch<EmployeeOption[]>('/employees/options', { query: { q: q || undefined }, signal });
  return rows.map((e) => ({ value: e.id, label: e.fullName, description: [e.position, e.department].filter(Boolean).join(' · ') || undefined }));
}

/** All departments of the tenant (filters). */
export function useAllDepartments() {
  return useQuery({
    queryKey: tk.departments,
    queryFn: ({ signal }) => apiFetch<Department[]>('/org/departments', { signal }),
    staleTime: 5 * 60_000,
  });
}
