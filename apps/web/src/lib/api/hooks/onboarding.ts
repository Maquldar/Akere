'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, baseHeaders, buildUrl } from '../client';
import { networkError, toApiError } from '../errors';
import { uploadFiles } from '../upload';
import type { FileRef, Page, UserAdmin } from '../types';
import type {
  AutofillConsentResult, CandidateCommentItem, CandidateDetail, CandidateDocumentView, CandidateExportInput, CandidateFilter,
  CandidateInput, CandidateListItem, CandidateUpdate, DocumentRequestView, EmployeeOption, HireInput, HireResult, ImportResult,
  PersonalDocTypeView, PortalCodeResult, PortalMe, QuestionnaireInput, QuestionnaireView, RequestDocumentsResult,
  RequestTemplateInput, RequestTemplateView, ReviewInput,
} from '../types-onboarding';

/** Query keys of the onboarding module (kept here so other modules never collide). */
export const ok = {
  all: ['candidates'] as const,
  list: (f?: object) => (f ? (['candidates', 'list', f] as const) : (['candidates', 'list'] as const)),
  detail: (id: string) => ['candidates', 'detail', id] as const,
  comments: (id: string) => ['candidates', 'comments', id] as const,
  request: (id: string) => ['candidates', 'request', id] as const,
  docTypes: ['onboarding', 'doc-types'] as const,
  templates: ['onboarding', 'templates'] as const,
  template: (id: string) => ['onboarding', 'templates', id] as const,
  questionnaires: ['onboarding', 'questionnaires'] as const,
  questionnaire: (id: string) => ['onboarding', 'questionnaires', id] as const,
  portalMe: ['portal', 'me'] as const,
  portalRequest: ['portal', 'request'] as const,
};

/** Builds a filter query: drops empty values. */
function filterQuery(f: CandidateFilter): Record<string, unknown> {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== null && v !== ''));
}

// Candidates ------------------------------------------------------------------------

export function useCandidates(filter: CandidateFilter) {
  return useQuery({
    queryKey: ok.list(filter),
    queryFn: ({ signal }) => apiFetch<Page<CandidateListItem>>('/candidates', { query: filterQuery(filter), signal }),
    placeholderData: keepPreviousData,
  });
}

/** Fetches up to `max` ids matching a filter (for "select all matching" bulk actions). */
export async function fetchCandidateIds(filter: CandidateFilter, max = 200): Promise<CandidateListItem[]> {
  const out: CandidateListItem[] = [];
  for (let page = 1; out.length < max; page++) {
    const res = await apiFetch<Page<CandidateListItem>>('/candidates', { query: filterQuery({ ...filter, page, pageSize: 100 }) });
    out.push(...res.items);
    if (res.items.length < 100 || out.length >= res.total) break;
  }
  return out.slice(0, max);
}

/** Async options for candidate pickers. */
export async function searchCandidates(q: string, signal?: AbortSignal) {
  const res = await apiFetch<Page<CandidateListItem>>('/candidates', { query: filterQuery({ q, page: 1, pageSize: 20 }), signal });
  return res.items.map((c) => ({ value: c.id, label: c.fullName, description: c.legalEntity.name }));
}

export function useCandidate(id: string | undefined) {
  return useQuery({
    queryKey: ok.detail(id ?? ''),
    queryFn: ({ signal }) => apiFetch<CandidateDetail>(`/candidates/${id}`, { signal }),
    enabled: Boolean(id),
  });
}

export function useSaveCandidate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: CandidateInput | CandidateUpdate }) =>
      id
        ? apiFetch<CandidateDetail>(`/candidates/${id}`, { method: 'PATCH', body: input })
        : apiFetch<CandidateDetail>('/candidates', { method: 'POST', body: input }),
    onSuccess: (c) => {
      qc.setQueryData(ok.detail(c.id), c);
      void qc.invalidateQueries({ queryKey: ok.list() });
    },
  });
}

export function useDeleteCandidate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/candidates/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ok.list() }),
  });
}

export function useRequestDocuments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { candidateIds: string[]; requestTemplateId: string }) =>
      apiFetch<RequestDocumentsResult>('/candidates/request-documents', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ok.all }),
  });
}

export function useResendInvite() {
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/candidates/${id}/resend-invite`, { method: 'POST' }),
  });
}

export function useImportCandidates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, legalEntityId, dryRun, onProgress }: { file: File; legalEntityId: string; dryRun: boolean; onProgress?: (f: number) => void }) =>
      uploadFiles<ImportResult>('/candidates/import', file, { fields: { legalEntityId }, query: dryRun ? { dryRun: true } : undefined, onProgress }),
    onSuccess: (res, vars) => {
      if (!vars.dryRun && res.created > 0) void qc.invalidateQueries({ queryKey: ok.list() });
    },
  });
}

// Comments ----------------------------------------------------------------------------

export function useCandidateComments(id: string) {
  return useQuery({
    queryKey: ok.comments(id),
    queryFn: ({ signal }) => apiFetch<CandidateCommentItem[]>(`/candidates/${id}/comments`, { signal }),
  });
}

export function useAddComment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (text: string) => apiFetch<CandidateCommentItem>(`/candidates/${id}/comments`, { method: 'POST', body: { text } }),
    onSuccess: (c) => {
      qc.setQueryData<CandidateCommentItem[]>(ok.comments(id), (old) => [...(old ?? []), c]);
      void qc.invalidateQueries({ queryKey: ok.list() });
      void qc.invalidateQueries({ queryKey: ok.detail(id) });
    },
  });
}

// HR review -----------------------------------------------------------------------------

export function useCandidateRequest(id: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ok.request(id),
    queryFn: ({ signal }) => apiFetch<DocumentRequestView>(`/candidates/${id}/request`, { signal }),
    enabled: options.enabled ?? true,
  });
}

function patchDocInRequest(old: DocumentRequestView | undefined, doc: CandidateDocumentView) {
  if (!old) return old;
  return { ...old, documents: old.documents.map((d) => (d.id === doc.id ? doc : d)) };
}

export function useSaveCandidateDoc(candidateId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ docId, values }: { docId: string; values: Record<string, unknown> }) =>
      apiFetch<CandidateDocumentView>(`/candidates/${candidateId}/request/documents/${docId}`, { method: 'PATCH', body: { values } }),
    onSuccess: (doc) => qc.setQueryData<DocumentRequestView>(ok.request(candidateId), (old) => patchDocInRequest(old, doc)),
  });
}

export function useUploadCandidateDocFile(candidateId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ docId, file, onProgress }: { docId: string; file: File; onProgress?: (f: number) => void }) =>
      uploadFiles<FileRef>(`/candidates/${candidateId}/request/documents/${docId}/files`, file, { onProgress }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ok.request(candidateId) }),
  });
}

export function useReview(candidateId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ReviewInput) => apiFetch<CandidateDetail>(`/candidates/${candidateId}/request/review`, { method: 'POST', body: input }),
    onSuccess: (c) => {
      qc.setQueryData(ok.detail(c.id), c);
      void qc.invalidateQueries({ queryKey: ok.request(candidateId) });
      void qc.invalidateQueries({ queryKey: ok.list() });
    },
  });
}

export function useHire(candidateId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: HireInput) => apiFetch<HireResult>(`/candidates/${candidateId}/hire`, { method: 'POST', body: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ok.detail(candidateId) });
      void qc.invalidateQueries({ queryKey: ok.list() });
    },
  });
}

// File downloads -------------------------------------------------------------------------

function filenameFrom(res: Response, fallback: string): string {
  const cd = res.headers.get('Content-Disposition') ?? '';
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  if (star?.[1]) return decodeURIComponent(star[1]);
  const plain = /filename="?([^";]+)"?/i.exec(cd);
  return plain?.[1] ?? fallback;
}

/** Fetches a file endpoint and triggers a browser download. */
export async function downloadFile(path: string, init: { method?: 'GET' | 'POST'; body?: unknown; fallbackName: string }): Promise<void> {
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = { ...baseHeaders(method), Accept: '*/*' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(buildUrl(path), {
      method,
      headers,
      credentials: 'include',
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch (e) {
    throw networkError(e);
  }
  if (!res.ok) {
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    throw toApiError(res.status, parsed, res.statusText || 'Download failed');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filenameFrom(res, init.fallbackName);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function useExportCandidates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CandidateExportInput) =>
      downloadFile('/candidates/export', { method: 'POST', body: input, fallbackName: `candidates.${input.format}` }),
    onSuccess: (_r, vars) => {
      if (vars.markExported) void qc.invalidateQueries({ queryKey: ok.all });
    },
  });
}

// People pickers ----------------------------------------------------------------------------

/** HR/ADMIN users for the "Ответственный" picker (admins can list users; HR falls back to employees). */
export async function searchResponsible(q: string, signal: AbortSignal | undefined, canListUsers: boolean) {
  if (canListUsers) {
    const [hr, admin] = await Promise.all([
      apiFetch<Page<UserAdmin>>('/org/users', { query: { q, role: 'HR', active: true, page: 1, pageSize: 20 }, signal }),
      apiFetch<Page<UserAdmin>>('/org/users', { query: { q, role: 'ADMIN', active: true, page: 1, pageSize: 20 }, signal }),
    ]);
    const seen = new Set<string>();
    return [...hr.items, ...admin.items]
      .filter((u) => (seen.has(u.id) ? false : (seen.add(u.id), true)))
      .map((u) => ({ value: u.id, label: u.fullName, description: u.email }));
  }
  const rows = await apiFetch<EmployeeOption[]>('/employees/options', { query: { q: q || undefined }, signal });
  return rows
    .filter((r) => r.userId)
    .map((r) => ({ value: r.userId!, label: r.fullName, description: [r.position, r.department].filter(Boolean).join(' · ') || undefined }));
}

/** Employees for the manager picker in the hire dialog (`id` = employee id). */
export async function searchEmployees(q: string, legalEntityId: string | undefined, signal?: AbortSignal) {
  const rows = await apiFetch<EmployeeOption[]>('/employees/options', { query: { q: q || undefined, legalEntityId }, signal });
  return rows.map((r) => ({ value: r.id, label: r.fullName, description: [r.position, r.department].filter(Boolean).join(' · ') || undefined }));
}

// Templates & questionnaires --------------------------------------------------------------------

export function usePersonalDocTypes() {
  return useQuery({
    queryKey: ok.docTypes,
    queryFn: ({ signal }) => apiFetch<PersonalDocTypeView[]>('/onboarding/personal-doc-types', { signal }),
    staleTime: 5 * 60_000,
  });
}

export function useRequestTemplates(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ok.templates,
    queryFn: ({ signal }) => apiFetch<RequestTemplateView[]>('/onboarding/request-templates', { signal }),
    enabled: options.enabled ?? true,
  });
}

export function useRequestTemplate(id: string | undefined) {
  return useQuery({
    queryKey: ok.template(id ?? ''),
    queryFn: ({ signal }) => apiFetch<RequestTemplateView>(`/onboarding/request-templates/${id}`, { signal }),
    enabled: Boolean(id),
  });
}

export function useSaveRequestTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: RequestTemplateInput }) =>
      id
        ? apiFetch<RequestTemplateView>(`/onboarding/request-templates/${id}`, { method: 'PATCH', body: input })
        : apiFetch<RequestTemplateView>('/onboarding/request-templates', { method: 'POST', body: input }),
    onSuccess: (t) => {
      qc.setQueryData(ok.template(t.id), t);
      void qc.invalidateQueries({ queryKey: ok.templates, exact: true });
    },
  });
}

export function useDeleteRequestTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/onboarding/request-templates/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ok.templates, exact: true }),
  });
}

export function useQuestionnaires(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ok.questionnaires,
    queryFn: ({ signal }) => apiFetch<QuestionnaireView[]>('/onboarding/questionnaires', { signal }),
    enabled: options.enabled ?? true,
  });
}

export function useQuestionnaire(id: string | undefined) {
  return useQuery({
    queryKey: ok.questionnaire(id ?? ''),
    queryFn: ({ signal }) => apiFetch<QuestionnaireView>(`/onboarding/questionnaires/${id}`, { signal }),
    enabled: Boolean(id),
  });
}

export function useSaveQuestionnaire() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: QuestionnaireInput }) =>
      id
        ? apiFetch<QuestionnaireView>(`/onboarding/questionnaires/${id}`, { method: 'PATCH', body: input })
        : apiFetch<QuestionnaireView>('/onboarding/questionnaires', { method: 'POST', body: input }),
    onSuccess: (q) => {
      qc.setQueryData(ok.questionnaire(q.id), q);
      void qc.invalidateQueries({ queryKey: ok.questionnaires, exact: true });
      void qc.invalidateQueries({ queryKey: ok.templates });
    },
  });
}

export function useDeleteQuestionnaire() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/onboarding/questionnaires/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ok.questionnaires, exact: true });
      void qc.invalidateQueries({ queryKey: ok.templates });
    },
  });
}

// Candidate portal (§6) ---------------------------------------------------------------------------

export function usePortalMe() {
  return useQuery({
    queryKey: ok.portalMe,
    queryFn: ({ signal }) => apiFetch<PortalMe>('/portal/me', { signal, skipAuthRedirect: true }),
    retry: false,
    staleTime: 5 * 60_000,
  });
}

export function usePortalRequestCode() {
  return useMutation({
    mutationFn: (login: string) => apiFetch<PortalCodeResult>('/portal/auth/request-code', { method: 'POST', body: { login } }),
  });
}

export function usePortalVerify() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { login: string; code: string }) => apiFetch<PortalMe>('/portal/auth/verify', { method: 'POST', body: input }),
    onSuccess: (me) => {
      qc.setQueryData(ok.portalMe, me);
      void qc.invalidateQueries({ queryKey: ok.portalRequest });
    },
  });
}

export function usePortalLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<void>('/portal/auth/logout', { method: 'POST' }),
    onSettled: () => {
      qc.removeQueries({ queryKey: ok.portalRequest });
      qc.setQueryData(ok.portalMe, null);
    },
  });
}

export function usePortalRequest(enabled: boolean) {
  return useQuery({
    queryKey: ok.portalRequest,
    queryFn: ({ signal }) => apiFetch<DocumentRequestView>('/portal/request', { signal }),
    enabled,
  });
}

export function usePortalSaveDoc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ docId, values }: { docId: string; values: Record<string, unknown> }) =>
      apiFetch<CandidateDocumentView>(`/portal/request/documents/${docId}`, { method: 'PATCH', body: { values } }),
    onSuccess: (doc) => qc.setQueryData<DocumentRequestView>(ok.portalRequest, (old) => patchDocInRequest(old, doc)),
  });
}

export function usePortalUploadFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ docId, file, onProgress }: { docId: string; file: File; onProgress?: (f: number) => void }) =>
      uploadFiles<FileRef>(`/portal/request/documents/${docId}/files`, file, { onProgress }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ok.portalRequest }),
  });
}

export function usePortalDeleteFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ docId, fileId }: { docId: string; fileId: string }) =>
      apiFetch<void>(`/portal/request/documents/${docId}/files/${fileId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ok.portalRequest }),
  });
}

export function usePortalSaveQuestionnaire() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (answers: Record<string, unknown>) =>
      apiFetch<DocumentRequestView>('/portal/request/questionnaire', { method: 'PATCH', body: { answers } }),
    onSuccess: (r) => qc.setQueryData(ok.portalRequest, r),
  });
}

export function usePortalAutofillConsent() {
  return useMutation({
    mutationFn: () => apiFetch<AutofillConsentResult>('/portal/request/autofill/consent', { method: 'POST' }),
  });
}

export function usePortalAutofillReply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reply: '511' | '512') => apiFetch<DocumentRequestView>('/portal/request/autofill/reply', { method: 'POST', body: { reply } }),
    onSuccess: (r) => qc.setQueryData(ok.portalRequest, r),
  });
}

export function usePortalSubmit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<DocumentRequestView>('/portal/request/submit', { method: 'POST' }),
    onSuccess: (r) => qc.setQueryData(ok.portalRequest, r),
  });
}
