'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../client';
import { isApiError } from '../errors';
import { qk } from '../query-keys';
import type { Department, FileRef, Page, UserRef } from '../types';
import type {
  CampaignInput, CampaignUpdate, CampaignView, PlanInput, PlanRow, ReqDocument, RequestDetail, RequestFilter,
  RequestInput, RequestListItem, RequestPreview, RequestTypeView, VacationApproveInput, VacationBalance,
  VacationBulkResult, VacationGridFilter,
} from '../types-requests';
import { uploadFiles } from '../upload';

/** Query keys of the requests module (kept here so the shared query-keys file stays untouched). */
export const rqk = {
  types: ['requests', 'types'] as const,
  list: (filter?: object) => (filter ? (['requests', 'list', filter] as const) : (['requests', 'list'] as const)),
  detail: (id: string) => ['requests', 'detail', id] as const,
  preview: (input: object) => ['requests', 'preview', input] as const,
  balance: (employeeId: string) => ['employees', employeeId, 'vacation-balance'] as const,
  campaigns: ['vacation', 'campaigns'] as const,
  grid: (campaignId: string, filter?: object) =>
    filter ? (['vacation', 'grid', campaignId, filter] as const) : (['vacation', 'grid', campaignId] as const),
  myPlan: (campaignId: string) => ['vacation', 'my-plan', campaignId] as const,
  allDepartments: ['org', 'departments', 'all'] as const,
};

// ── Request types & balance ──

export function useRequestTypes(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: rqk.types,
    queryFn: ({ signal }) => apiFetch<RequestTypeView[]>('/request-types', { signal }),
    staleTime: 5 * 60_000,
    enabled: options.enabled ?? true,
  });
}

export function useVacationBalance(employeeId: string | null | undefined) {
  return useQuery({
    queryKey: rqk.balance(employeeId ?? ''),
    queryFn: ({ signal }) => apiFetch<VacationBalance>(`/employees/${employeeId}/vacation-balance`, { signal }),
    enabled: Boolean(employeeId),
    staleTime: 30_000,
  });
}

// ── Requests ──

export function useRequests(filter: RequestFilter, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: rqk.list(filter),
    queryFn: ({ signal }) => apiFetch<Page<RequestListItem>>('/requests', { query: filter, signal }),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

export function useRequest(id: string) {
  return useQuery({
    queryKey: rqk.detail(id),
    queryFn: ({ signal }) => apiFetch<RequestDetail>(`/requests/${id}`, { signal }),
    retry: (count, e) => count < 2 && !(isApiError(e) && [403, 404].includes(e.status)),
  });
}

/** Debounced callers pass a stable input; `null` disables the preview. */
export function useRequestPreview(input: RequestInput | null, excludeId?: string) {
  return useQuery({
    queryKey: rqk.preview({ input, excludeId }),
    queryFn: ({ signal }) =>
      apiFetch<RequestPreview>('/requests/preview', {
        method: 'POST',
        body: input,
        query: excludeId ? { excludeId } : undefined,
        signal,
      }),
    enabled: input !== null,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: false,
  });
}

function useInvalidateRequests() {
  const qc = useQueryClient();
  return (id?: string) => {
    void qc.invalidateQueries({ queryKey: rqk.list() });
    void qc.invalidateQueries({ queryKey: qk.inboxCounts });
    void qc.invalidateQueries({ queryKey: ['employees'] });
    if (id) void qc.invalidateQueries({ queryKey: rqk.detail(id) });
  };
}

export function useSaveRequest() {
  const invalidate = useInvalidateRequests();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: RequestInput }) =>
      id
        ? apiFetch<RequestDetail>(`/requests/${id}`, { method: 'PATCH', body: input })
        : apiFetch<RequestDetail>('/requests', { method: 'POST', body: input }),
    onSuccess: (r) => invalidate(r.id),
  });
}

export function useSubmitRequest() {
  const invalidate = useInvalidateRequests();
  return useMutation({
    mutationFn: (id: string) => apiFetch<RequestDetail>(`/requests/${id}/submit`, { method: 'POST' }),
    onSuccess: (r) => invalidate(r.id),
  });
}

export function useCancelRequest() {
  const invalidate = useInvalidateRequests();
  return useMutation({
    mutationFn: (id: string) => apiFetch<RequestDetail>(`/requests/${id}/cancel`, { method: 'POST' }),
    onSuccess: (r) => invalidate(r.id),
  });
}

/** POST /uploads — temporary attachment (linked to the request on save). */
export function uploadAttachment(file: File, onProgress?: (f: number) => void) {
  return uploadFiles<FileRef>('/uploads', file, { onProgress });
}

// ── Route actions on the application / order documents (API.md §7) ──

export type DocDecision = 'approve' | 'return' | 'reject';

export function useDocumentDecision(requestId: string) {
  const invalidate = useInvalidateRequests();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ documentId, decision, comment }: { documentId: string; decision: DocDecision; comment?: string }) =>
      apiFetch<ReqDocument>(`/documents/${documentId}/${decision}`, {
        method: 'POST',
        body: decision === 'approve' ? (comment ? { comment } : {}) : { comment: comment ?? '' },
      }),
    onSuccess: (_d, v) => {
      invalidate(requestId);
      void qc.invalidateQueries({ queryKey: ['documents'] });
      void qc.invalidateQueries({ queryKey: ['documents', v.documentId] });
    },
  });
}

// ── Pickers ──

export async function searchEmployees(q: string, signal?: AbortSignal) {
  const rows = await apiFetch<UserRef[]>('/employees/options', { query: { q: q || undefined }, signal });
  return rows.map((u) => ({ value: u.id, label: u.fullName, description: [u.position, u.department].filter(Boolean).join(' · ') || undefined }));
}

export function useAllDepartments(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: rqk.allDepartments,
    queryFn: ({ signal }) => apiFetch<Department[]>('/org/departments', { signal }),
    staleTime: 60_000,
    enabled: options.enabled ?? true,
  });
}

// ── Vacation schedule (§9) ──

export function useCampaigns() {
  return useQuery({
    queryKey: rqk.campaigns,
    queryFn: ({ signal }) => apiFetch<CampaignView[]>('/vacation-schedule/campaigns', { signal }),
    staleTime: 30_000,
  });
}

export function useSaveCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: CampaignInput | CampaignUpdate }) =>
      id
        ? apiFetch<CampaignView>(`/vacation-schedule/campaigns/${id}`, { method: 'PATCH', body: input })
        : apiFetch<CampaignView>('/vacation-schedule/campaigns', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vacation'] }),
  });
}

export function useVacationGrid(campaignId: string | undefined, filter: VacationGridFilter) {
  return useQuery({
    queryKey: rqk.grid(campaignId ?? '', filter),
    queryFn: ({ signal }) => apiFetch<Page<PlanRow>>(`/vacation-schedule/campaigns/${campaignId}/grid`, { query: filter, signal }),
    enabled: Boolean(campaignId),
    placeholderData: keepPreviousData,
  });
}

export function useMyPlan(campaignId: string | undefined, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: rqk.myPlan(campaignId ?? ''),
    queryFn: ({ signal }) => apiFetch<PlanRow>(`/vacation-schedule/campaigns/${campaignId}/my-plan`, { signal }),
    enabled: Boolean(campaignId) && (options.enabled ?? true),
    retry: false,
  });
}

export function useSavePlan(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ employeeId, input }: { employeeId: string; input: PlanInput }) =>
      apiFetch<PlanRow>(`/vacation-schedule/campaigns/${campaignId}/plans/${employeeId}`, { method: 'PUT', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vacation'] }),
  });
}

export function useApprovePlans(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: VacationApproveInput) =>
      apiFetch<VacationBulkResult>(`/vacation-schedule/campaigns/${campaignId}/approve`, { method: 'POST', body: input }),
    onSuccess: (_r, v) => {
      if (!v.dryRun) void qc.invalidateQueries({ queryKey: ['vacation'] });
    },
  });
}

export const campaignExportUrl = (campaignId: string) => `/api/v1/vacation-schedule/campaigns/${campaignId}/export`;
