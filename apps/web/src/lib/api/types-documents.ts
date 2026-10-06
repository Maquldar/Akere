/**
 * P3 API shapes: documents, signing, configuration (API.md §7), employees and deputies (API.md §4).
 * Names follow API.md / packages/shared schemas.
 */
import type { DateStr, FileRef, Gender, Option, PageQuery, Role, UserRef } from './types';

// §7 Documents ------------------------------------------------------------------

export type DocumentKind = 'GENERIC' | 'CONTRACT' | 'SUPPLEMENTARY' | 'ORDER' | 'APPLICATION' | 'VND' | 'ARCHIVE';
export type DocumentStatus = 'DRAFT' | 'IN_ROUTE' | 'REWORK' | 'COMPLETED' | 'REJECTED' | 'CANCELLED';
export type StepAction = 'APPROVE' | 'SIGN' | 'ACKNOWLEDGE';
export type StepStatus = 'WAITING' | 'PENDING' | 'DONE' | 'REJECTED' | 'RETURNED' | 'SKIPPED';
export type SignMethod = 'EGOV_MOBILE' | 'EGOV_BUSINESS' | 'NCALAYER' | 'PAPER' | 'CLICK';
export type SessionMethod = 'EGOV_MOBILE' | 'EGOV_BUSINESS' | 'NCALAYER';
export type AssigneeRule = 'USER' | 'ROLE_HR' | 'MANAGER_OF_SUBJECT' | 'SUBJECT' | 'SIGNATORY' | 'AUTHOR';
export type DocumentBox = 'inbox' | 'outbox' | 'drafts' | 'all' | 'archive';
export type EsutdStatus = 'NOT_SENT' | 'SENT' | 'ERROR' | string;

export const DOCUMENT_KINDS: DocumentKind[] = ['GENERIC', 'CONTRACT', 'SUPPLEMENTARY', 'ORDER', 'APPLICATION', 'VND', 'ARCHIVE'];
export const DOCUMENT_STATUSES: DocumentStatus[] = ['DRAFT', 'IN_ROUTE', 'REWORK', 'COMPLETED', 'REJECTED', 'CANCELLED'];
export const STEP_ACTIONS: StepAction[] = ['APPROVE', 'SIGN', 'ACKNOWLEDGE'];
export const ASSIGNEE_RULES: AssigneeRule[] = ['SIGNATORY', 'SUBJECT', 'MANAGER_OF_SUBJECT', 'ROLE_HR', 'AUTHOR', 'USER'];
export const DOCUMENT_BOXES: DocumentBox[] = ['inbox', 'outbox', 'drafts', 'all', 'archive'];

/** Subject in list items carries the employee id next to the user id. */
export type SubjectRef = UserRef & { employeeId?: string };

export type DocumentListItem = {
  id: string;
  title: string;
  number: string | null;
  kind: DocumentKind;
  type: Option;
  status: DocumentStatus;
  legalEntity: Option;
  subject: SubjectRef | null;
  author: UserRef;
  currentStep: { action: StepAction; assignee: UserRef; dueAt: string | null } | null;
  myPendingAction: StepAction | null;
  dueAt: string | null;
  overdue: boolean;
  createdAt: string;
  updatedAt: string;
};

export type RouteStepView = {
  id: string;
  order: number;
  action: StepAction;
  status: StepStatus;
  assignee: UserRef;
  actedBy: UserRef | null;
  onBehalfOf: UserRef | null;
  dueAt: string | null;
  viewedAt: string | null;
  actedAt: string | null;
  comment: string | null;
  signatureMethod: SignMethod | null;
};

export type DocumentFileView = {
  id: string;
  name: string;
  currentVersion: number;
  versions: { version: number; file: FileRef; uploadedBy: UserRef; createdAt: string }[];
};

export type DocumentLinkItem = {
  id: string;
  relation: string;
  direction: 'from' | 'to';
  document: { id: string; title: string; number: string | null; status: DocumentStatus };
};

export type DocumentCommentItem = { id: string; text: string; author: UserRef | null; createdAt: string };

export type DocumentDetail = DocumentListItem & {
  data: Record<string, unknown>;
  registeredAt: DateStr | null;
  backdated: boolean;
  paperSigned: boolean;
  pdfUrl: string | null;
  signedPdfUrl: string | null;
  steps: RouteStepView[];
  files: DocumentFileView[];
  links: DocumentLinkItem[];
  commentsCount: number;
  esutd: { status: EsutdStatus; sentAt: string | null; error: string | null } | null;
  canEdit: boolean;
  canStart: boolean;
  canCancel: boolean;
  canRegister: boolean;
  request: { id: string; status: string } | null;
};

export type DocumentFilter = PageQuery & {
  box?: DocumentBox;
  q?: string;
  kind?: DocumentKind;
  documentTypeId?: string;
  status?: DocumentStatus;
  legalEntityId?: string;
  subjectEmployeeId?: string;
  authorId?: string;
  dateFrom?: DateStr;
  dateTo?: DateStr;
  overdue?: boolean;
  sort?: 'createdAt' | 'number' | 'dueAt';
  order?: 'asc' | 'desc';
};

export type DocumentCreate = {
  documentTypeId: string;
  legalEntityId: string;
  title?: string;
  subjectEmployeeId?: string | null;
  data: Record<string, unknown>;
  dueAt?: string | null;
  startRoute: boolean;
};

export type DocumentBulkCreate = Omit<DocumentCreate, 'subjectEmployeeId' | 'title'> & { subjectEmployeeIds: string[] };

export type DocumentUpdate = { title?: string; data?: Record<string, unknown>; dueAt?: string | null };

export type BulkResult = { succeeded: string[]; failed: { id: string; reason: string }[] };

export type SignatureVerification = {
  valid: boolean;
  signatures: { signer: UserRef; method: SignMethod; signedAt: string; valid: boolean }[];
};

// Signing --------------------------------------------------------------------------

export type SigningSessionStatus = 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED';

export type SigningSessionView = {
  id: string;
  method: SignMethod;
  status: SigningSessionStatus;
  qrDataUrl: string | null;
  qrUrl: string | null;
  expiresAt: string;
  documentIds: string[];
  signedCount: number;
};

export type SigningQrView = { session: SigningSessionView; documents: { id: string; title: string; number: string | null }[] };

// Configuration ------------------------------------------------------------------

export type TemplateBlock =
  | { type: 'heading'; text: string; align?: 'left' | 'center' }
  | { type: 'paragraph'; text: string }
  | { type: 'fields'; rows: { label: string; value: string }[] }
  | { type: 'signatures'; parties: { label: string; name: string }[] }
  | { type: 'spacer' };

export type DocumentTypeInput = {
  code: string;
  name: string;
  nameKk?: string | null;
  kind: DocumentKind;
  numberPattern: string;
  templateId?: string | null;
  routeTemplateId?: string | null;
  esutdRequired: boolean;
  isActive: boolean;
};

export type DocumentTypeView = DocumentTypeInput & { id: string; template: Option | null; routeTemplate: Option | null };

export type DocumentTemplateView = { id: string; name: string; body: TemplateBlock[]; updatedAt: string };
export type DocumentTemplateInput = { name: string; body: TemplateBlock[] };

export type TemplateVariable = { key: string; label: string; example: string };

export type RouteStepDef = { order: number; action: StepAction; rule: AssigneeRule; userId?: string; dueDays?: number };
export type RouteTemplateView = { id: string; name: string; steps: RouteStepDef[]; usedBy: number; updatedAt: string };
export type RouteTemplateInput = { name: string; steps: RouteStepDef[] };

// §4 Employees -----------------------------------------------------------------------

export type EmployeeStatus = 'ACTIVE' | 'TERMINATED';

export type EmployeeListItem = {
  id: string;
  userId: string;
  fullName: string;
  tabNumber: string;
  legalEntity: Option;
  department: Option | null;
  position: Option | null;
  manager: UserRef | null;
  status: EmployeeStatus;
  hireDate: DateStr;
  email: string;
  phone: string | null;
};

export type DeputyItem = { id: string; principal: UserRef; deputy: UserRef; startDate: DateStr; endDate: DateStr; active: boolean };

export type EmployeeProfile = EmployeeListItem & {
  iin: string | null;
  birthDate: DateStr | null;
  gender: Gender | null;
  terminationDate: DateStr | null;
  location: Option | null;
  roles: Role[];
  vacationDaysPerYear: number;
  vacationBalance: number;
  personal: Record<string, unknown>;
  photoUrl: string | null;
  deputies: DeputyItem[];
  candidateId: string | null;
  /** Extra flag returned by the API: current user may run HR actions on this employee. */
  canManage?: boolean;
};

export type EmployeeFilter = PageQuery & {
  q?: string;
  legalEntityId?: string;
  departmentId?: string;
  positionId?: string;
  managerId?: string;
  status?: EmployeeStatus;
  sort?: 'lastName' | 'hireDate' | 'tabNumber';
  order?: 'asc' | 'desc';
};

/** `/employees/options`: `id` is the employee id, `userId` the account id. */
export type EmployeeOption = UserRef & { userId: string };

export type EmployeeUpdate = {
  departmentId?: string | null;
  positionId?: string | null;
  managerId?: string | null;
  locationId?: string | null;
  tabNumber?: string;
  vacationDaysPerYear?: number;
  personal?: Record<string, unknown>;
};

export type VacationEntry = { id: string; type: 'ACCRUAL' | 'USAGE' | 'ADJUSTMENT'; days: number; date: DateStr; note: string | null };
export type VacationBalance = { available: number; accrued: number; used: number; adjusted: number; perYear: number; entries: VacationEntry[] };
export type VacationAdjustmentInput = { days: number; date: DateStr; note: string };

export type TransferInput = {
  effectiveDate: DateStr;
  departmentId?: string;
  positionId?: string;
  managerId?: string;
  salary?: number;
  reason?: string;
};
export type DismissalInput = { effectiveDate: DateStr; reason: string; article: string };

export type PersonalDocumentField = { key: string; label?: string; labelKk?: string; type?: string };
export type CandidateDocumentView = {
  id: string;
  docType: { id: string; code: string; name: string; nameKk: string | null; fields: unknown; autoFillable: boolean };
  required: boolean;
  fieldKeys: string[];
  status: string;
  values: Record<string, unknown>;
  autoFilledKeys: string[];
  files: FileRef[];
  returnComment: string | null;
};

export type DeputyInput = { principalUserId?: string; deputyUserId: string; startDate: DateStr; endDate: DateStr };
