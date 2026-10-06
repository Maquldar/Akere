/**
 * Candidate onboarding + candidate portal shapes (API.md §5, §6). Names match API.md.
 */
import type { ContactChannel, DateStr, FileRef, Gender, Locale, Option, PageQuery, UserRef } from './types';

export type CandidateStatus = 'NEW' | 'IN_PROGRESS' | 'ACCEPTED' | 'EXPORTED' | 'BLOCKED';
export type InvitationStatus = 'NONE' | 'SENT' | 'ACCEPTED';
export type DocRequestStatus = 'NONE' | 'SENT' | 'FILLING' | 'UPLOADED' | 'COMPLETED' | 'RETURNED';
export type CandidateCheck = 'NONE' | 'ON_REVIEW' | 'RECOMMENDED' | 'CONDITIONAL' | 'NOT_RECOMMENDED';
export type CandidateDocStatus = 'PENDING' | 'FILLED' | 'ACCEPTED' | 'RETURNED';
export type ConsentStatus = 'NONE' | 'REQUESTED' | 'GRANTED' | 'DENIED';
export type FormFieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'checkbox' | 'file';

export const CANDIDATE_STATUSES: CandidateStatus[] = ['NEW', 'IN_PROGRESS', 'ACCEPTED', 'EXPORTED', 'BLOCKED'];
export const INVITATION_STATUSES: InvitationStatus[] = ['NONE', 'SENT', 'ACCEPTED'];
export const DOC_REQUEST_STATUSES: DocRequestStatus[] = ['NONE', 'SENT', 'FILLING', 'UPLOADED', 'COMPLETED', 'RETURNED'];
export const CANDIDATE_CHECKS: CandidateCheck[] = ['NONE', 'ON_REVIEW', 'RECOMMENDED', 'CONDITIONAL', 'NOT_RECOMMENDED'];
export const CONTACT_CHANNELS: ContactChannel[] = ['EMAIL', 'SMS', 'WHATSAPP'];

export type CandidateInput = {
  legalEntityId: string;
  lastName: string;
  firstName: string;
  middleName?: string | null;
  iin?: string | null;
  noIin?: boolean;
  birthDate?: DateStr | null;
  gender?: Gender | null;
  channels: ContactChannel[];
  email?: string | null;
  phone?: string | null;
  comment?: string | null;
  tags?: string[];
  responsibleUserId?: string | null;
  departmentId?: string | null;
  positionId?: string | null;
  plannedHireDate?: DateStr | null;
};

export type CandidateUpdate = Partial<CandidateInput> & { status?: CandidateStatus };

export type CandidateFilter = PageQuery & {
  q?: string;
  status?: CandidateStatus;
  invitationStatus?: InvitationStatus;
  docRequestStatus?: DocRequestStatus;
  checkStatus?: CandidateCheck;
  responsibleUserId?: string;
  legalEntityId?: string;
  tag?: string;
  updatedFrom?: DateStr;
  updatedTo?: DateStr;
  sort?: 'updatedAt' | 'lastName' | 'createdAt';
  order?: 'asc' | 'desc';
};

export type CandidateListItem = {
  id: string;
  fullName: string;
  status: CandidateStatus;
  invitationStatus: InvitationStatus;
  docRequestStatus: DocRequestStatus;
  checkStatus: CandidateCheck;
  responsible: UserRef | null;
  legalEntity: Option;
  commentsCount: number;
  tags: string[];
  updatedAt: string;
};

export type CandidateDetail = CandidateListItem &
  Omit<CandidateInput, 'tags'> & {
    tags: string[];
    createdAt: string;
    employeeId: string | null;
    exportedAt: string | null;
    position: Option | null;
    department: Option | null;
  };

export type ImportResult = { created: number; errors: { row: number; field: string; message: string }[] };

export type FormField = {
  key: string;
  label: string;
  labelKk?: string;
  type: FormFieldType;
  required: boolean;
  options?: string[];
};

export type PersonalDocTypeView = {
  id: string;
  code: string;
  name: string;
  nameKk: string | null;
  fields: FormField[];
  autoFillable: boolean;
};

export type RequestTemplateItem = { personalDocType: PersonalDocTypeView; required: boolean; fieldKeys: string[] };
export type RequestTemplateView = {
  id: string;
  name: string;
  questionnaire: Option | null;
  items: RequestTemplateItem[];
  updatedAt: string;
};
export type RequestTemplateInput = {
  name: string;
  questionnaireTemplateId?: string | null;
  items: { personalDocTypeId: string; required: boolean; fieldKeys: string[] }[];
};

export type QuestionnaireView = { id: string; name: string; fields: FormField[]; updatedAt: string };
export type QuestionnaireInput = { name: string; fields: FormField[] };

export type CandidateDocumentView = {
  id: string;
  docType: PersonalDocTypeView;
  required: boolean;
  fieldKeys: string[];
  status: CandidateDocStatus;
  values: Record<string, unknown>;
  autoFilledKeys: string[];
  files: FileRef[];
  returnComment: string | null;
};

export type DocumentRequestView = {
  id: string;
  status: DocRequestStatus;
  consentStatus: ConsentStatus;
  template: Option;
  questionnaire: QuestionnaireView | null;
  questionnaireAnswers: Record<string, unknown>;
  documents: CandidateDocumentView[];
  readyAt: string | null;
  reviewedAt: string | null;
  reviewComment: string | null;
  createdAt: string;
};

export type CandidateCommentItem = {
  id: string;
  text: string;
  author: UserRef | null;
  byCandidate: boolean;
  createdAt: string;
};

export type ReviewInput = {
  decision: 'ACCEPT' | 'RETURN' | 'REJECT';
  comment?: string;
  checkStatus?: CandidateCheck;
  returnDocIds?: string[];
};

export type HireInput = {
  legalEntityId: string;
  departmentId: string;
  positionId: string;
  managerId?: string | null;
  locationId?: string | null;
  hireDate: DateStr;
  tabNumber?: string;
  salary: number;
  probationMonths?: number;
  generateDocuments: boolean;
};
export type HireResult = { employeeId: string; documentIds: string[] };

export type RequestDocumentsResult = { sent: number; skipped: { candidateId: string; reason: string }[] };

export type ExportFormat = 'json' | 'xml' | 'xlsx';
export type CandidateExportInput = { candidateIds?: string[]; format: ExportFormat; markExported: boolean };

/** `GET /employees/options` item (API.md §4): `id` is the employee id. */
export type EmployeeOption = UserRef & { userId?: string };

// §6 Portal ----------------------------------------------------------------------

export type PortalMe = { candidateId: string; fullName: string; legalEntity: string; locale: Locale };
export type PortalCodeResult = { channel: ContactChannel; maskedTarget: string };
export type AutofillConsentResult = { status: 'REQUESTED'; smsPreview: string };

/** `422 BUSINESS_RULE rule=REQUIRED_MISSING` → `details.missing[]` (portal/routes.ts). */
export type MissingItem = { type: 'document' | 'questionnaire'; id: string; code: string; name: string; fields: string[] };
