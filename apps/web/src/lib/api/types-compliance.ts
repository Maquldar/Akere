/**
 * Phase 5 API types (API.md §7 archive, §10 ВНД, §11 ЕСУТД, §14 reports, §15 API keys, §16 help).
 * Shapes follow packages/shared/src/schemas/p5.ts and the route handlers in apps/api/src/modules/{vnd,esutd,…}.
 */
import type { DateStr, Option, PageQuery, UserRef } from './types';

// ───────────── ВНД ─────────────
export type VndStatus = 'DRAFT' | 'IN_ROUTE' | 'COMPLETED';
export type VndRecipientStatus = 'PENDING' | 'ACKNOWLEDGED';
export type VndTab = 'all' | 'in_progress' | 'completed';

export type VndListItem = {
  id: string;
  number: string | null;
  title: string;
  type: Option;
  sentAt: string | null;
  acknowledged: number;
  total: number;
  status: VndStatus;
  commentsCount: number;
  legalEntity: Option;
  myStatus?: VndRecipientStatus;
};

export type VndDetail = VndListItem & {
  fileUrl: string;
  dueAt: string | null;
  author: UserRef;
  /** Backend extras (vnd/service.ts vndDetail). */
  requireSignature?: boolean;
  createdAt?: string;
  canManage?: boolean;
  canAcknowledge?: boolean;
  pdfUrl?: string | null;
  signedPdfUrl?: string | null;
  fileName?: string | null;
};

export type VndRecipientView = {
  id: string;
  employee: UserRef & { employeeId?: string };
  status: VndRecipientStatus;
  sentAt: string;
  acknowledgedAt: string | null;
};

export type VndFilter = PageQuery & {
  tab?: VndTab;
  q?: string;
  legalEntityId?: string;
  dateFrom?: DateStr;
  dateTo?: DateStr;
};

export type VndRecipientsFilter = PageQuery & { status?: VndRecipientStatus; departmentId?: string; q?: string };

export type VndRecipientsInput = { employeeIds?: string[]; departmentIds?: string[]; allOfLegalEntity?: boolean };

export type VndCreateInput = {
  title: string;
  legalEntityId: string;
  documentTypeId?: string;
  dueAt?: DateStr;
  requireSignature: boolean;
  file: File;
};

// ───────────── Signing (API.md §7 "Signing") ─────────────
export type SigningMethod = 'EGOV_MOBILE' | 'EGOV_BUSINESS' | 'NCALAYER';
export type SigningSessionStatus = 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED';
export type SigningSessionView = {
  id: string;
  method: SigningMethod;
  status: SigningSessionStatus;
  qrDataUrl: string | null;
  qrUrl: string | null;
  expiresAt: string;
  documentIds: string[];
  signedCount: number;
};

// ───────────── ЕСУТД ─────────────
export type EsutdStatus = 'NOT_SENT' | 'QUEUED' | 'SENT' | 'ERROR';
export type EsutdItem = {
  documentId: string;
  number: string | null;
  type: Option;
  title: string;
  employee: UserRef | null;
  signer: UserRef | null;
  status: EsutdStatus;
  sentAt: string | null;
  externalId: string | null;
  error: string | null;
};
export type EsutdFilter = PageQuery & { status?: EsutdStatus; legalEntityId?: string; q?: string };
export type BulkResult = { succeeded: string[]; failed: { id: string; reason: string }[] };

// ───────────── Archive ─────────────
export type DocumentKind = 'GENERIC' | 'CONTRACT' | 'SUPPLEMENTARY' | 'ORDER' | 'APPLICATION' | 'VND' | 'ARCHIVE';
export type DocumentTypeOption = { id: string; code: string; name: string; nameKk?: string | null; kind: DocumentKind; isActive: boolean };
export type ArchiveItemInput = {
  documentTypeId: string;
  legalEntityId: string;
  title: string;
  number?: string;
  registeredAt: DateStr;
  subjectEmployeeId?: string;
};
export type ArchiveResult = { documentIds: string[]; errors: { index: number; message: string }[] };

// ───────────── Reports ─────────────
export type CandidateStatus = 'NEW' | 'IN_PROGRESS' | 'ACCEPTED' | 'EXPORTED' | 'BLOCKED';
export type Dashboard = {
  headcount: number;
  hiredInPeriod: number;
  dismissedInPeriod: number;
  turnoverPct: number;
  candidates: Record<CandidateStatus, number>;
  documents: { inRoute: number; overdue: number; completedInPeriod: number; avgCompletionHours: number | null };
  requests: { pending: number; completedInPeriod: number };
  vnd: { inProgress: number; completionPct: number };
  esutd: { notSent: number; errors: number };
  absencesToday: { vacation: number; sick: number; businessTrip: number };
};
export type HeadcountReport = {
  byDepartment: { department: Option; count: number }[];
  byPosition: { position: Option; count: number }[];
  total: number;
};
export type MovementsReport = { months: { month: string; hired: number; dismissed: number; transferred: number }[] };
export type ReportPeriod = { legalEntityId?: string; from?: DateStr; to?: DateStr };
export type ReportExport = 'headcount' | 'movements' | 'documents' | 'vnd';

// ───────────── API keys ─────────────
export const API_KEY_SCOPES = ['candidates:read', 'candidates:write', 'employees:read', 'timesheet:read', 'documents:read'] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];
export type ApiKeyView = {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiKeyScope[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};
export type ApiKeyCreated = { id: string; key: string };

// ───────────── Help ─────────────
export const HELP_CATEGORIES = ['start', 'documents', 'onboarding', 'employees', 'time', 'vnd', 'esutd', 'reports', 'integrations', 'security'] as const;
export type HelpCategory = (typeof HELP_CATEGORIES)[number];
export type HelpArticle = { slug: string; title: string; body: string; category: HelpCategory | string };
export type SupportTicketInput = { subject: string; message: string };
