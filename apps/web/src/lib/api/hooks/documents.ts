'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { apiFetch, buildUrl, baseHeaders } from '../client';
import { toApiError } from '../errors';
import { qk } from '../query-keys';
import { uploadFiles } from '../upload';
import type { Page } from '../types';
import type {
  BulkResult, CandidateDocumentView, DeputyInput, DeputyItem, DismissalInput, DocumentBulkCreate, DocumentCommentItem,
  DocumentCreate, DocumentDetail, DocumentFileView, DocumentFilter, DocumentLinkItem, DocumentListItem, DocumentTemplateInput,
  DocumentTemplateView, DocumentTypeInput, DocumentTypeView, DocumentUpdate, EmployeeFilter, EmployeeListItem, EmployeeOption,
  EmployeeProfile, EmployeeUpdate, RouteTemplateInput, RouteTemplateView, SessionMethod, SignatureVerification,
  SigningQrView, SigningSessionView, TemplateVariable, TransferInput, VacationAdjustmentInput, VacationBalance,
} from '../types-documents';

/** Query keys of the documents module. */
export const dk = {
  documents: (filter?: object) => (filter ? (['documents', 'list', filter] as const) : (['documents', 'list'] as const)),
  document: (id: string) => ['documents', 'detail', id] as const,
  comments: (id: string) => ['documents', 'detail', id, 'comments'] as const,
  verify: (id: string) => ['documents', 'detail', id, 'verify'] as const,
  types: (params?: object) => (params ? (['document-types', params] as const) : (['document-types'] as const)),
  templates: ['document-templates'] as const,
  template: (id: string) => ['document-templates', id] as const,
  variables: ['document-templates', 'variables'] as const,
  routes: ['route-templates'] as const,
  session: (id: string) => ['signing', 'session', id] as const,
  qr: (token: string) => ['signing', 'qr', token] as const,
  employees: (filter?: object) => (filter ? (['employees', 'list', filter] as const) : (['employees', 'list'] as const)),
  employee: (id: string) => ['employees', 'detail', id] as const,
  employeeDocs: (id: string, params?: object) => ['employees', 'detail', id, 'documents', params ?? {}] as const,
  personalDocs: (id: string) => ['employees', 'detail', id, 'personal'] as const,
  vacation: (id: string) => ['employees', 'detail', id, 'vacation'] as const,
  deputies: (mine?: boolean) => ['deputies', mine ? 'mine' : 'all'] as const,
};

/** Everything that may change after a route action (lists, card, sidebar counters, e-dossier lists). */
export function invalidateDocuments(qc: QueryClient, id?: string) {
  void qc.invalidateQueries({ queryKey: ['documents'] });
  void qc.invalidateQueries({ queryKey: qk.inboxCounts });
  void qc.invalidateQueries({ queryKey: ['employees'] });
  if (id) void qc.invalidateQueries({ queryKey: dk.document(id) });
}

// Registry -----------------------------------------------------------------------

export function useDocuments(filter: DocumentFilter, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: dk.documents(filter),
    queryFn: ({ signal }) => apiFetch<Page<DocumentListItem>>('/documents', { query: filter, signal }),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

/** Fetcher for document pickers (links). */
export async function searchDocuments(q: string, signal?: AbortSignal) {
  const page = await apiFetch<Page<DocumentListItem>>('/documents', { query: { q: q || undefined, box: 'all', page: 1, pageSize: 20 }, signal });
  return page.items;
}

export function useDocument(id: string) {
  return useQuery({
    queryKey: dk.document(id),
    queryFn: ({ signal }) => apiFetch<DocumentDetail>(`/documents/${id}`, { signal }),
  });
}

export function useCreateDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DocumentCreate) => apiFetch<DocumentDetail>('/documents', { method: 'POST', body: input }),
    onSuccess: () => invalidateDocuments(qc),
  });
}

export function useBulkCreateDocuments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DocumentBulkCreate) => apiFetch<{ documentIds: string[] }>('/documents/bulk', { method: 'POST', body: input }),
    onSuccess: () => invalidateDocuments(qc),
  });
}

export function useBulkApprove() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (documentIds: string[]) => apiFetch<BulkResult>('/documents/bulk-approve', { method: 'POST', body: { documentIds } }),
    onSuccess: () => invalidateDocuments(qc),
  });
}

// Card actions ------------------------------------------------------------------------

type DocAction =
  | { kind: 'update'; input: DocumentUpdate }
  | { kind: 'start' }
  | { kind: 'cancel'; reason: string }
  | { kind: 'register'; number?: string; registeredAt?: string }
  | { kind: 'approve'; comment?: string }
  | { kind: 'return'; comment: string }
  | { kind: 'reject'; comment: string };

export function useDocumentAction(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: DocAction) => {
      switch (a.kind) {
        case 'update':
          return apiFetch<DocumentDetail>(`/documents/${id}`, { method: 'PATCH', body: a.input });
        case 'start':
          return apiFetch<DocumentDetail>(`/documents/${id}/start`, { method: 'POST' });
        case 'cancel':
          return apiFetch<DocumentDetail>(`/documents/${id}/cancel`, { method: 'POST', body: { reason: a.reason } });
        case 'register':
          return apiFetch<DocumentDetail>(`/documents/${id}/register`, { method: 'POST', body: { number: a.number, registeredAt: a.registeredAt } });
        case 'approve':
          return apiFetch<DocumentDetail>(`/documents/${id}/approve`, { method: 'POST', body: { comment: a.comment } });
        case 'return':
          return apiFetch<DocumentDetail>(`/documents/${id}/return`, { method: 'POST', body: { comment: a.comment } });
        case 'reject':
          return apiFetch<DocumentDetail>(`/documents/${id}/reject`, { method: 'POST', body: { comment: a.comment } });
      }
    },
    onSuccess: (doc) => {
      qc.setQueryData(dk.document(id), doc);
      invalidateDocuments(qc, id);
    },
  });
}

export function useDeleteDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/documents/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateDocuments(qc),
  });
}

export function usePaperSigned(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, registeredAt, onProgress }: { file: File; registeredAt?: string; onProgress?: (f: number) => void }) =>
      uploadFiles<DocumentDetail>(`/documents/${id}/paper-signed`, file, { fields: { registeredAt }, onProgress }),
    onSuccess: (doc) => {
      qc.setQueryData(dk.document(id), doc);
      invalidateDocuments(qc, id);
    },
  });
}

export function useUploadDocumentFile(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, documentFileId, onProgress }: { file: File; documentFileId?: string; onProgress?: (f: number) => void }) =>
      uploadFiles<DocumentFileView>(`/documents/${id}/files`, file, { fields: { documentFileId }, onProgress }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: dk.document(id) }),
  });
}

export function useDocumentComments(id: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: dk.comments(id),
    queryFn: ({ signal }) => apiFetch<DocumentCommentItem[]>(`/documents/${id}/comments`, { signal }),
    enabled: options.enabled ?? true,
  });
}

export function useAddComment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (text: string) => apiFetch<DocumentCommentItem>(`/documents/${id}/comments`, { method: 'POST', body: { text } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: dk.comments(id) });
      void qc.invalidateQueries({ queryKey: dk.document(id), exact: true });
    },
  });
}

export function useAddLink(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { toId: string; relation: string }) => apiFetch<DocumentLinkItem>(`/documents/${id}/links`, { method: 'POST', body: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['documents', 'detail'] }),
  });
}

export function useDeleteLink(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (linkId: string) => apiFetch<void>(`/documents/${id}/links/${linkId}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['documents', 'detail'] }),
  });
}

export function useVerifySignatures(id: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: dk.verify(id),
    queryFn: ({ signal }) => apiFetch<SignatureVerification>(`/documents/${id}/signatures/verify`, { signal }),
    enabled: options.enabled ?? true,
  });
}

/** Fetches a PDF (GET url or POST preview) as a Blob, raising ApiError on failure. */
export async function fetchPdf(path: string, init: { method?: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal } = {}): Promise<Blob> {
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = { ...baseHeaders(method), Accept: 'application/pdf, application/json' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const url = path.startsWith('/api/') ? path : buildUrl(path);
  const res = await fetch(url, {
    method,
    headers,
    credentials: 'include',
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: init.signal,
  });
  if (!res.ok) {
    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch {
      parsed = undefined;
    }
    throw toApiError(res.status, parsed, res.statusText || 'Request failed');
  }
  return res.blob();
}

// Signing ------------------------------------------------------------------------------

export function useCreateSigningSession() {
  return useMutation({
    mutationFn: (input: { documentIds: string[]; method: SessionMethod }) =>
      apiFetch<SigningSessionView>('/signing/sessions', { method: 'POST', body: input }),
  });
}

export function useSigningSession(id: string | null, options: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: dk.session(id ?? ''),
    queryFn: ({ signal }) => apiFetch<SigningSessionView>(`/signing/sessions/${id}`, { signal }),
    enabled: Boolean(id),
    refetchInterval: options.poll ? 2000 : false,
    refetchIntervalInBackground: true,
  });
}

export function useNcaLayerSign() {
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

export function useSigningQr(token: string) {
  return useQuery({
    queryKey: dk.qr(token),
    queryFn: ({ signal }) => apiFetch<SigningQrView>(`/signing/qr/${token}`, { signal }),
    retry: false,
  });
}

export function useConfirmSigningQr(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (decision: 'SIGN' | 'DECLINE') =>
      apiFetch<SigningSessionView>(`/signing/qr/${token}/confirm`, { method: 'POST', body: { decision } }),
    onSuccess: () => invalidateDocuments(qc),
  });
}

// Configuration -------------------------------------------------------------------------

export function useDocumentTypes(params: { active?: boolean } = {}, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: dk.types(params),
    queryFn: ({ signal }) => apiFetch<DocumentTypeView[]>('/document-types', { query: params, signal }),
    staleTime: 60_000,
    enabled: options.enabled ?? true,
  });
}

export function useSaveDocumentType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: Partial<DocumentTypeInput> }) =>
      id
        ? apiFetch<DocumentTypeView>(`/document-types/${id}`, { method: 'PATCH', body: input })
        : apiFetch<DocumentTypeView>('/document-types', { method: 'POST', body: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: dk.types() }),
  });
}

export function useDocumentTemplates(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: dk.templates,
    queryFn: ({ signal }) => apiFetch<DocumentTemplateView[]>('/document-templates', { signal }),
    staleTime: 30_000,
    enabled: options.enabled ?? true,
  });
}

export function useDocumentTemplate(id: string | null | undefined, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: dk.template(id ?? ''),
    queryFn: ({ signal }) => apiFetch<DocumentTemplateView>(`/document-templates/${id}`, { signal }),
    enabled: Boolean(id) && (options.enabled ?? true),
    retry: false,
  });
}

export function useSaveDocumentTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: DocumentTemplateInput }) =>
      id
        ? apiFetch<DocumentTemplateView>(`/document-templates/${id}`, { method: 'PATCH', body: input })
        : apiFetch<DocumentTemplateView>('/document-templates', { method: 'POST', body: input }),
    onSuccess: (t) => {
      qc.setQueryData(dk.template(t.id), t);
      void qc.invalidateQueries({ queryKey: dk.templates, exact: true });
      void qc.invalidateQueries({ queryKey: dk.types() });
    },
  });
}

export function useTemplateVariables() {
  return useQuery({
    queryKey: dk.variables,
    queryFn: ({ signal }) => apiFetch<TemplateVariable[]>('/document-templates/variables', { signal }),
    staleTime: 5 * 60_000,
  });
}

export function useRouteTemplates(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: dk.routes,
    queryFn: ({ signal }) => apiFetch<RouteTemplateView[]>('/route-templates', { signal }),
    staleTime: 30_000,
    enabled: options.enabled ?? true,
  });
}

export function useSaveRouteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: RouteTemplateInput }) =>
      id
        ? apiFetch<RouteTemplateView>(`/route-templates/${id}`, { method: 'PATCH', body: input })
        : apiFetch<RouteTemplateView>('/route-templates', { method: 'POST', body: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: dk.routes });
      void qc.invalidateQueries({ queryKey: dk.types() });
    },
  });
}

export function useDeleteRouteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/route-templates/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: dk.routes }),
  });
}

// Employees ----------------------------------------------------------------------------

export function useEmployees(filter: EmployeeFilter, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: dk.employees(filter),
    queryFn: ({ signal }) => apiFetch<Page<EmployeeListItem>>('/employees', { query: filter, signal }),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

/** Fetcher for async employee pickers (`/employees/options`). */
export function searchEmployees(q: string, signal?: AbortSignal, legalEntityId?: string) {
  return apiFetch<EmployeeOption[]>('/employees/options', { query: { q: q || undefined, legalEntityId }, signal });
}

export function useEmployee(id: string) {
  return useQuery({
    queryKey: dk.employee(id),
    queryFn: ({ signal }) => apiFetch<EmployeeProfile>(`/employees/${id}`, { signal }),
  });
}

export function useUpdateEmployee(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: EmployeeUpdate) => apiFetch<EmployeeProfile>(`/employees/${id}`, { method: 'PATCH', body: input }),
    onSuccess: (p) => {
      qc.setQueryData(dk.employee(id), p);
      void qc.invalidateQueries({ queryKey: dk.employees() });
    },
  });
}

export function useEmployeeDocuments(id: string, params: { page: number; pageSize: number }, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: dk.employeeDocs(id, params),
    queryFn: ({ signal }) => apiFetch<Page<DocumentListItem>>(`/employees/${id}/documents`, { query: params, signal }),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

export function usePersonalDocuments(id: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: dk.personalDocs(id),
    queryFn: ({ signal }) => apiFetch<CandidateDocumentView[]>(`/employees/${id}/personal-documents`, { signal }),
    enabled: options.enabled ?? true,
  });
}

export function useVacationBalance(id: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: dk.vacation(id),
    queryFn: ({ signal }) => apiFetch<VacationBalance>(`/employees/${id}/vacation-balance`, { signal }),
    enabled: options.enabled ?? true,
  });
}

export function useVacationAdjustment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: VacationAdjustmentInput) =>
      apiFetch<VacationBalance>(`/employees/${id}/vacation-adjustments`, { method: 'POST', body: input }),
    onSuccess: (b) => {
      qc.setQueryData(dk.vacation(id), b);
      void qc.invalidateQueries({ queryKey: dk.employee(id), exact: true });
    },
  });
}

export function useHrEvent(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { kind: 'transfer'; input: TransferInput } | { kind: 'dismissal'; input: DismissalInput }) =>
      apiFetch<DocumentDetail>(`/employees/${id}/events/${a.kind}`, { method: 'POST', body: a.input }),
    onSuccess: (doc) => {
      qc.setQueryData(dk.document(doc.id), doc);
      invalidateDocuments(qc);
    },
  });
}

// Deputies ------------------------------------------------------------------------------

export function useDeputies(mine: boolean) {
  return useQuery({
    queryKey: dk.deputies(mine),
    queryFn: ({ signal }) => apiFetch<DeputyItem[]>('/deputies', { query: { mine: mine || undefined }, signal }),
  });
}

export function useCreateDeputy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DeputyInput) => apiFetch<DeputyItem>('/deputies', { method: 'POST', body: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['deputies'] });
      void qc.invalidateQueries({ queryKey: ['employees', 'detail'] });
    },
  });
}

export function useDeleteDeputy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/deputies/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['deputies'] });
      void qc.invalidateQueries({ queryKey: ['employees', 'detail'] });
    },
  });
}
