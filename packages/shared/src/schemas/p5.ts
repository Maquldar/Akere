import { z } from 'zod';
import { dateStr, id, pageQuery } from '../validators';
import { CANDIDATE_STATUSES } from './onboarding';
import { DOCUMENT_KINDS, DOCUMENT_STATUSES } from './documents';

/** Phase 5: ВНД (F-34), ЕСУТД (F-24), archive (F-25), reports (F-35), public API (F-50), help (F-48). */

const text = (max: number) => z.string().trim().min(1).max(max);
const optText = (max: number) => z.string().trim().max(max).optional();

// ───────────── ВНД ─────────────
export const VND_STATUSES = ['DRAFT', 'IN_ROUTE', 'COMPLETED'] as const;
export type VndStatus = (typeof VND_STATUSES)[number];
export const VND_RECIPIENT_STATUSES = ['PENDING', 'ACKNOWLEDGED'] as const;
export type VndRecipientStatus = (typeof VND_RECIPIENT_STATUSES)[number];
export const VND_TABS = ['all', 'in_progress', 'completed'] as const;

export const VndListQuery = pageQuery.extend({
  tab: z.enum(VND_TABS).default('all'),
  q: optText(200),
  legalEntityId: id.optional(),
  dateFrom: dateStr.optional(),
  dateTo: dateStr.optional(),
});
/** Multipart text fields of POST /vnd (the file goes in field `file`). */
export const VndCreateFields = z.object({
  title: text(300),
  legalEntityId: id,
  documentTypeId: id.optional(),
  dueAt: z.string().datetime({ offset: true }).or(dateStr).optional(),
  /** 'false' allows acknowledgment without ЭЦП (simple click); default: ЭЦП required. */
  requireSignature: z.enum(['true', 'false']).default('true'),
});
export const VndRecipientsQuery = pageQuery.extend({
  status: z.enum(VND_RECIPIENT_STATUSES).optional(),
  departmentId: id.optional(),
  q: optText(200),
});
export const VndRecipientsInput = z
  .object({
    employeeIds: z.array(id).max(5000).optional(),
    departmentIds: z.array(id).max(500).optional(),
    allOfLegalEntity: z.boolean().optional(),
  })
  .refine((v) => (v.employeeIds?.length ?? 0) > 0 || (v.departmentIds?.length ?? 0) > 0 || v.allOfLegalEntity === true, {
    message: 'Choose employees, departments or the whole legal entity',
  });
export const VndMyQuery = z.object({ status: z.enum(VND_RECIPIENT_STATUSES).optional() });
export const VndAcknowledgeInput = z.object({ signingSessionId: id.optional() });

export type VndListItem = {
  id: string; number: string | null; title: string; type: { id: string; name: string }; sentAt: string | null;
  acknowledged: number; total: number; status: VndStatus; commentsCount: number; legalEntity: { id: string; name: string };
  myStatus?: VndRecipientStatus;
};
type Ref = { id: string; fullName: string; shortName: string; position: string | null; department: string | null };
export type VndDetail = VndListItem & { fileUrl: string; dueAt: string | null; author: Ref; requireSignature: boolean; createdAt: string };
export type VndRecipientView = { id: string; employee: Ref & { employeeId: string }; status: VndRecipientStatus; sentAt: string; acknowledgedAt: string | null };

// ───────────── ЕСУТД ─────────────
export const ESUTD_STATUSES = ['NOT_SENT', 'QUEUED', 'SENT', 'ERROR'] as const;
export type EsutdStatus = (typeof ESUTD_STATUSES)[number];
export const EsutdQuery = pageQuery.extend({ status: z.enum(ESUTD_STATUSES).optional(), legalEntityId: id.optional(), q: optText(200) });
export const EsutdSubmitInput = z.object({ documentIds: z.array(id).min(1).max(500) });
export type EsutdItem = {
  documentId: string; number: string | null; type: { id: string; name: string }; title: string; employee: Ref | null; signer: Ref | null;
  status: EsutdStatus; sentAt: string | null; externalId: string | null; error: string | null;
};

// ───────────── Archive ─────────────
export const ArchiveItem = z.object({
  documentTypeId: id,
  legalEntityId: id,
  title: text(300),
  number: z.string().trim().max(60).optional(),
  registeredAt: dateStr,
  subjectEmployeeId: id.optional(),
});
export type ArchiveItem = z.infer<typeof ArchiveItem>;
export const ArchiveMeta = z.array(ArchiveItem).min(1).max(50);

// ───────────── Reports ─────────────
export const ReportPeriodQuery = z.object({ legalEntityId: id.optional(), from: dateStr.optional(), to: dateStr.optional() });
export const HeadcountQuery = z.object({ legalEntityId: id.optional(), date: dateStr.optional() });
export const REPORT_EXPORTS = ['headcount', 'movements', 'documents', 'vnd'] as const;
export const ReportExportParams = z.object({ report: z.enum(REPORT_EXPORTS) });
export const ReportExportQuery = z.object({ legalEntityId: id.optional(), from: dateStr.optional(), to: dateStr.optional(), date: dateStr.optional() });
export type Dashboard = {
  headcount: number; hiredInPeriod: number; dismissedInPeriod: number; turnoverPct: number;
  candidates: Record<(typeof CANDIDATE_STATUSES)[number], number>;
  documents: { inRoute: number; overdue: number; completedInPeriod: number; avgCompletionHours: number | null };
  requests: { pending: number; completedInPeriod: number };
  vnd: { inProgress: number; completionPct: number };
  esutd: { notSent: number; errors: number };
  absencesToday: { vacation: number; sick: number; businessTrip: number };
};
export type HeadcountReport = { byDepartment: { department: { id: string; name: string }; count: number }[]; byPosition: { position: { id: string; name: string }; count: number }[]; total: number };
export type MovementsReport = { months: { month: string; hired: number; dismissed: number; transferred: number }[] };

// ───────────── API keys + public API ─────────────
export const API_KEY_SCOPES = ['candidates:read', 'candidates:write', 'employees:read', 'timesheet:read', 'documents:read'] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];
export const ApiKeyInput = z.object({ name: text(120), scopes: z.array(z.enum(API_KEY_SCOPES)).min(1).max(API_KEY_SCOPES.length) });
export type ApiKeyView = { id: string; name: string; prefix: string; scopes: ApiKeyScope[]; lastUsedAt: string | null; revokedAt: string | null; createdAt: string };

const updatedFrom = z.string().datetime({ offset: true }).or(dateStr);
export const PublicCandidatesQuery = pageQuery.extend({ status: z.enum(CANDIDATE_STATUSES).default('ACCEPTED'), updatedFrom: updatedFrom.optional(), tag: optText(60) });
export const PublicMarkExportedInput = z.object({ candidateIds: z.array(id).min(1).max(500) });
export const PublicEmployeesQuery = pageQuery.extend({ legalEntityId: id.optional(), status: z.enum(['ACTIVE', 'TERMINATED']).optional(), updatedFrom: updatedFrom.optional() });
export const PublicTimesheetQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  legalEntityId: id.optional(),
});
export const PublicDocumentsQuery = pageQuery.extend({
  status: z.enum(DOCUMENT_STATUSES).default('COMPLETED'),
  updatedFrom: updatedFrom.optional(),
  kind: z.enum(DOCUMENT_KINDS).optional(),
});

// ───────────── Help ─────────────
export const HELP_CATEGORIES = ['start', 'documents', 'onboarding', 'employees', 'time', 'vnd', 'esutd', 'reports', 'integrations', 'security'] as const;
export type HelpCategory = (typeof HELP_CATEGORIES)[number];
export const HelpArticlesQuery = z.object({ q: optText(200), lang: z.enum(['ru', 'kk', 'en']).optional() });
export type HelpArticle = { slug: string; title: string; body: string; category: HelpCategory };
export const SupportTicketInput = z.object({ subject: text(200), message: text(5000) });
