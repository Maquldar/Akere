/**
 * P4 API shapes: requests (API.md §8), vacation schedule (API.md §9), vacation balance (§4) and the subset of
 * DocumentDetail (§7) that the request card renders. Names match API.md / packages/shared/src/schemas/requests.ts.
 * Document types are prefixed `Req*` so they never clash with the documents module's own types file.
 */
import type { DateStr, FileRef, Option, PageQuery, UserRef } from './types';

// ── Shared ──

export type DynamicFieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'checkbox' | 'file';
/** `FormField` from API.md §5 (request types reuse it for their dynamic fields). */
export type DynamicField = {
  key: string;
  label: string;
  labelKk?: string;
  type: DynamicFieldType;
  required: boolean;
  options?: string[];
};

export type AbsenceKind = 'VACATION' | 'UNPAID' | 'SICK' | 'BUSINESS_TRIP' | 'OTHER';
export type EmployeeRef = UserRef & { employeeId: string };

// ── Vacation balance (§4) ──

export type VacationBalance = {
  available: number;
  accrued: number;
  used: number;
  adjusted: number;
  perYear: number;
  entries: { id: string; type: 'ACCRUAL' | 'USAGE' | 'ADJUSTMENT'; days: number; date: DateStr; note: string | null }[];
};

// ── Documents subset (§7) ──

export type ReqDocumentStatus = 'DRAFT' | 'IN_ROUTE' | 'REWORK' | 'COMPLETED' | 'REJECTED' | 'CANCELLED';
export type ReqStepAction = 'APPROVE' | 'SIGN' | 'ACKNOWLEDGE';
export type ReqStepStatus = 'WAITING' | 'PENDING' | 'DONE' | 'REJECTED' | 'RETURNED' | 'SKIPPED';
export type ReqSignMethod = 'EGOV_MOBILE' | 'EGOV_BUSINESS' | 'NCALAYER' | 'PAPER' | 'CLICK';

export type ReqRouteStep = {
  id: string;
  order: number;
  action: ReqStepAction;
  status: ReqStepStatus;
  assignee: UserRef;
  actedBy: UserRef | null;
  onBehalfOf: UserRef | null;
  dueAt: string | null;
  viewedAt: string | null;
  actedAt: string | null;
  comment: string | null;
  signatureMethod: ReqSignMethod | null;
};

export type ReqDocument = {
  id: string;
  title: string;
  number: string | null;
  kind: string;
  type: Option;
  status: ReqDocumentStatus;
  legalEntity: Option;
  subject: UserRef | null;
  author: UserRef;
  currentStep: { action: ReqStepAction; assignee: UserRef; dueAt: string | null } | null;
  myPendingAction: ReqStepAction | null;
  dueAt: string | null;
  overdue: boolean;
  createdAt: string;
  updatedAt: string;
  registeredAt: DateStr | null;
  pdfUrl: string | null;
  signedPdfUrl: string | null;
  steps: ReqRouteStep[];
};

// ── Requests (§8) ──

export type RequestStatus = 'DRAFT' | 'IN_APPROVAL' | 'REWORK' | 'ORDER_SIGNING' | 'COMPLETED' | 'REJECTED' | 'CANCELLED';
export const REQUEST_STATUSES: RequestStatus[] = ['DRAFT', 'IN_APPROVAL', 'REWORK', 'ORDER_SIGNING', 'COMPLETED', 'REJECTED', 'CANCELLED'];
export type RequestScope = 'mine' | 'team' | 'all';

export type RequestTypeView = {
  id: string;
  code: 'ANNUAL_LEAVE' | 'UNPAID_LEAVE' | 'BUSINESS_TRIP' | 'SOCIAL_LEAVE' | 'CERTIFICATE' | (string & {});
  name: string;
  nameKk: string | null;
  fields: DynamicField[];
  usesVacationBalance: boolean;
  requiresAttachment: boolean;
  hasDates: boolean;
  absenceKind: AbsenceKind | null;
};

export type RequestListItem = {
  id: string;
  /** API also sends `code` (shared schema extension). */
  type: Option & { code?: string };
  employee: UserRef & { employeeId?: string };
  status: RequestStatus;
  startDate: DateStr | null;
  endDate: DateStr | null;
  days: number | null;
  createdAt: string;
  submittedAt: string | null;
};

export type RequestTimelineItem = { at: string; label: string; actor: UserRef | null };

export type RequestDetail = RequestListItem & {
  data: Record<string, unknown>;
  applicationDocument: ReqDocument | null;
  orderDocument: ReqDocument | null;
  attachments: FileRef[];
  timeline: RequestTimelineItem[];
  // Implementation extensions (apps/api requests service); optional so the UI falls back gracefully.
  completedAt?: string | null;
  vacationBalance?: number | null;
  canEdit?: boolean;
  canSubmit?: boolean;
  canCancel?: boolean;
};

export type RequestInput = {
  requestTypeId: string;
  startDate?: DateStr | null;
  endDate?: DateStr | null;
  data: Record<string, unknown>;
  attachmentFileIds?: string[];
  submit: boolean;
};

export type RequestPreview = { days: number; balanceAfter: number | null; pdfDataUrl: string; warnings: string[] };

export type RequestFilter = PageQuery & {
  scope: RequestScope;
  status?: RequestStatus;
  requestTypeId?: string;
  employeeId?: string;
};

// ── Vacation schedule (§9) ──

export type CampaignStatus = 'DRAFT' | 'ACTIVE' | 'CLOSED';
export type PlanStatus = 'NONE' | 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
export const PLAN_STATUSES: PlanStatus[] = ['NONE', 'DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'];

export type CampaignView = {
  id: string;
  year: number;
  status: CampaignStatus;
  deadline: DateStr | null;
  totals: { employees: number; submitted: number; approved: number };
};

export type PlanPeriod = { id: string; startDate: DateStr; endDate: DateStr; days: number };

export type PlanRow = {
  employee: EmployeeRef;
  status: PlanStatus;
  entitlement: number;
  planned: number;
  periods: PlanPeriod[];
  comment: string | null;
  canApprove: boolean;
};

export type CampaignInput = { year: number; deadline?: DateStr | null };
export type CampaignUpdate = { status?: 'ACTIVE' | 'CLOSED'; deadline?: DateStr | null };
export type PlanInput = { periods: { startDate: DateStr; endDate: DateStr }[]; submit: boolean };

export type VacationGridFilter = PageQuery & {
  status?: PlanStatus;
  employeeId?: string;
  departmentId?: string;
  positionId?: string;
  q?: string;
};

export type VacationApproveInput = {
  employeeIds: string[];
  decision: 'APPROVE' | 'REJECT';
  comment?: string;
  /** Extension (shared schema): validate only, for the "selected N, can approve M" dialog. */
  dryRun?: boolean;
};

/** API.md says `failed[].id`; the shared schema names it `employeeId`. Both are accepted. */
export type VacationBulkResult = { succeeded: string[]; failed: { id?: string; employeeId?: string; reason: string }[] };
