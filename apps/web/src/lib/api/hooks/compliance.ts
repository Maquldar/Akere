'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../client';
import { uploadFiles } from '../upload';
import type { Page, UserRef } from '../types';
import type {
  ApiKeyCreated, ApiKeyScope, ApiKeyView, ArchiveItemInput, ArchiveResult, BulkResult, Dashboard, DocumentKind,
  DocumentTypeOption, EsutdFilter, EsutdItem, HeadcountReport, HelpArticle, MovementsReport, ReportPeriod,
  SigningMethod, SigningSessionView, SupportTicketInput, VndCreateInput, VndDetail, VndFilter, VndListItem,
  VndRecipientStatus, VndRecipientsFilter, VndRecipientsInput, VndRecipientView,
} from '../types-compliance';

/** Query keys of the compliance module (ВНД, ЕСУТД, archive, reports, API keys, help). */
export const ck = {
  vnd: ['vnd'] as const,
  vndList: (f: VndFilter) => ['vnd', 'list', f] as const,
  vndMy: (status?: VndRecipientStatus) => ['vnd', 'my', status ?? 'all'] as const,
  vndDetail: (id: string) => ['vnd', 'detail', id] as const,
  vndRecipients: (id: string, f?: VndRecipientsFilter) =>
    f ? (['vnd', 'detail', id, 'recipients', f] as const) : (['vnd', 'detail', id, 'recipients'] as const),
  signingSession: (id: string) => ['signing', 'session', id] as const,
  esutd: ['esutd'] as const,
  esutdList: (f: EsutdFilter) => ['esutd', 'list', f] as const,
  esutdCount: ['esutd', 'count'] as const,
  documentTypes: (kind?: DocumentKind) => ['document-types', kind ?? 'all'] as const,
  reports: ['reports'] as const,
  dashboard: (p: ReportPeriod) => ['reports', 'dashboard', p] as const,
  headcount: (p: { legalEntityId?: string; date?: string }) => ['reports', 'headcount', p] as const,
  movements: (p: ReportPeriod) => ['reports', 'movements', p] as const,
  apiKeys: ['api-keys'] as const,
  helpArticles: (q?: string) => ['help', 'articles', q ?? ''] as const,
};

const inboxKey = ['me', 'inbox-counts'] as const;

// ───────────── ВНД ─────────────

export function useVndList(filter: VndFilter, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ck.vndList(filter),
    queryFn: ({ signal }) => apiFetch<Page<VndListItem>>('/vnd', { query: filter, signal }),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

export function useMyVnd(status?: VndRecipientStatus, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ck.vndMy(status),
    queryFn: ({ signal }) => apiFetch<VndListItem[]>('/vnd/my', { query: { status }, signal }),
    enabled: options.enabled ?? true,
  });
}

export function useVnd(id: string) {
  return useQuery({
    queryKey: ck.vndDetail(id),
    queryFn: ({ signal }) => apiFetch<VndDetail>(`/vnd/${id}`, { signal }),
  });
}

export function useVndRecipients(id: string, filter: VndRecipientsFilter, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ck.vndRecipients(id, filter),
    queryFn: ({ signal }) => apiFetch<Page<VndRecipientView>>(`/vnd/${id}/recipients`, { query: filter, signal }),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

export function useCreateVnd() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ input, onProgress }: { input: VndCreateInput; onProgress?: (f: number) => void }) =>
      uploadFiles<VndDetail>('/vnd', input.file, {
        fields: {
          title: input.title,
          legalEntityId: input.legalEntityId,
          documentTypeId: input.documentTypeId,
          dueAt: input.dueAt,
          requireSignature: input.requireSignature ? 'true' : 'false',
        },
        onProgress,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ck.vnd }),
  });
}

export function useAddVndRecipients(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: VndRecipientsInput) => apiFetch<{ added: number }>(`/vnd/${id}/recipients`, { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ck.vnd }),
  });
}

export function useRemoveVndRecipient(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (recipientId: string) => apiFetch<void>(`/vnd/${id}/recipients/${recipientId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ck.vnd }),
  });
}

export function useSendVnd(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<VndDetail>(`/vnd/${id}/send`, { method: 'POST' }),
    onSuccess: (d) => {
      qc.setQueryData(ck.vndDetail(id), d);
      return qc.invalidateQueries({ queryKey: ck.vnd });
    },
  });
}

export function useAcknowledgeVnd(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (signingSessionId?: string) =>
      apiFetch<VndDetail>(`/vnd/${id}/acknowledge`, { method: 'POST', body: signingSessionId ? { signingSessionId } : {} }),
    onSuccess: (d) => {
      qc.setQueryData(ck.vndDetail(id), d);
      void qc.invalidateQueries({ queryKey: inboxKey });
      return qc.invalidateQueries({ queryKey: ck.vnd });
    },
  });
}

// ───────────── Signing sessions (ВНД acknowledgment = ACKNOWLEDGE signature) ─────────────

export function useCreateSigningSession() {
  return useMutation({
    mutationFn: (input: { documentIds: string[]; method: SigningMethod }) =>
      apiFetch<SigningSessionView>('/signing/sessions', { method: 'POST', body: input }),
  });
}

/** Polls a signing session every 2 s while it is PENDING. */
export function useSigningSession(id: string | null | undefined) {
  return useQuery({
    queryKey: ck.signingSession(id ?? ''),
    queryFn: ({ signal }) => apiFetch<SigningSessionView>(`/signing/sessions/${id}`, { signal }),
    enabled: Boolean(id),
    refetchInterval: (q) => (q.state.data && q.state.data.status !== 'PENDING' ? false : 2000),
  });
}

export function useSignWithNcaLayer() {
  return useMutation({
    mutationFn: ({ sessionId, pin }: { sessionId: string; pin: string }) =>
      apiFetch<SigningSessionView>(`/signing/sessions/${sessionId}/ncalayer`, { method: 'POST', body: { pin } }),
  });
}

export function useCancelSigningSession() {
  return useMutation({
    mutationFn: (sessionId: string) => apiFetch<void>(`/signing/sessions/${sessionId}/cancel`, { method: 'POST' }),
  });
}

// ───────────── ЕСУТД ─────────────

export function useEsutd(filter: EsutdFilter) {
  return useQuery({
    queryKey: ck.esutdList(filter),
    queryFn: ({ signal }) => apiFetch<Page<EsutdItem>>('/esutd', { query: filter, signal }),
    placeholderData: keepPreviousData,
    // Auto-refresh while something is queued for the adapter.
    refetchInterval: (q) => (q.state.data?.items.some((i) => i.status === 'QUEUED') ? 3000 : false),
  });
}

export function useEsutdCount(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ck.esutdCount,
    queryFn: ({ signal }) => apiFetch<{ notSent: number; errors: number }>('/esutd/count', { signal }),
    enabled: options.enabled ?? true,
  });
}

export function useEsutdSubmit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (documentIds: string[]) => apiFetch<BulkResult>('/esutd/submit', { method: 'POST', body: { documentIds } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ck.esutd }),
  });
}

// ───────────── Archive ─────────────

export function useDocumentTypes(kind?: DocumentKind) {
  return useQuery({
    queryKey: ck.documentTypes(kind),
    queryFn: ({ signal }) => apiFetch<DocumentTypeOption[]>('/document-types', { query: { kind, active: true }, signal }),
    staleTime: 60_000,
  });
}

export function useArchiveUpload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ files, meta, onProgress }: { files: File[]; meta: ArchiveItemInput[]; onProgress?: (f: number) => void }) =>
      uploadFiles<ArchiveResult>('/documents/archive', files, { fields: { meta }, fileField: 'files[]', onProgress }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents'] }),
  });
}

/** Employee picker source (`GET /employees/options`, ids are employee ids). */
export async function searchEmployeeOptions(q: string, legalEntityId: string | undefined, signal?: AbortSignal) {
  const rows = await apiFetch<UserRef[]>('/employees/options', { query: { q: q || undefined, legalEntityId }, signal });
  return rows.map((r) => ({ value: r.id, label: r.fullName, description: [r.position, r.department].filter(Boolean).join(' · ') || undefined }));
}

// ───────────── Reports ─────────────

export function useDashboard(p: ReportPeriod) {
  return useQuery({
    queryKey: ck.dashboard(p),
    queryFn: ({ signal }) => apiFetch<Dashboard>('/reports/dashboard', { query: p, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useHeadcount(p: { legalEntityId?: string; date?: string }) {
  return useQuery({
    queryKey: ck.headcount(p),
    queryFn: ({ signal }) => apiFetch<HeadcountReport>('/reports/headcount', { query: p, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useMovements(p: ReportPeriod) {
  return useQuery({
    queryKey: ck.movements(p),
    queryFn: ({ signal }) => apiFetch<MovementsReport>('/reports/movements', { query: p, signal }),
    placeholderData: keepPreviousData,
  });
}

// ───────────── API keys ─────────────

export function useApiKeys() {
  return useQuery({
    queryKey: ck.apiKeys,
    queryFn: ({ signal }) => apiFetch<ApiKeyView[]>('/api-keys', { signal }),
  });
}

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; scopes: ApiKeyScope[] }) => apiFetch<ApiKeyCreated>('/api-keys', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ck.apiKeys }),
  });
}

export function useRevokeApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/api-keys/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ck.apiKeys }),
  });
}

// ───────────── Help ─────────────

export function useHelpArticles(q?: string) {
  return useQuery({
    queryKey: ck.helpArticles(q),
    queryFn: ({ signal }) => apiFetch<HelpArticle[]>('/help/articles', { query: { q: q || undefined }, signal }),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });
}

export function useCreateTicket() {
  return useMutation({
    mutationFn: (input: SupportTicketInput) => apiFetch<{ id: string }>('/help/tickets', { method: 'POST', body: input }),
  });
}
