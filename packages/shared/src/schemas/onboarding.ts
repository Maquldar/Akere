import { z } from 'zod';
import { CONTACT_CHANNELS, GENDERS } from '../enums';
import { dateStr, email, id, isValidIinBin, pageQuery, phone } from '../validators';

// ── Enums (API.md §5) ──
export const CANDIDATE_STATUSES = ['NEW', 'IN_PROGRESS', 'ACCEPTED', 'EXPORTED', 'BLOCKED'] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];
export const INVITATION_STATUSES = ['NONE', 'SENT', 'ACCEPTED'] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];
export const DOC_REQUEST_STATUSES = ['NONE', 'SENT', 'FILLING', 'UPLOADED', 'COMPLETED', 'RETURNED'] as const;
export type DocRequestStatus = (typeof DOC_REQUEST_STATUSES)[number];
export const CANDIDATE_CHECKS = ['NONE', 'ON_REVIEW', 'RECOMMENDED', 'CONDITIONAL', 'NOT_RECOMMENDED'] as const;
export type CandidateCheck = (typeof CANDIDATE_CHECKS)[number];
export const CANDIDATE_DOC_STATUSES = ['PENDING', 'FILLED', 'ACCEPTED', 'RETURNED'] as const;
export type CandidateDocStatus = (typeof CANDIDATE_DOC_STATUSES)[number];
export const CONSENT_STATUSES = ['NONE', 'REQUESTED', 'GRANTED', 'DENIED'] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];
export const FORM_FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'select', 'checkbox', 'file'] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

const name = (max: number) => z.string().trim().min(1).max(max);
const optText = (max: number) => z.string().trim().max(max).nullish();

// ── Candidates ──
/** Object part of CandidateInput (no cross-field rules), usable with .partial(). */
export const CandidateBase = z.object({
  legalEntityId: id,
  lastName: name(100),
  firstName: name(100),
  middleName: optText(100),
  iin: z.string().trim().refine(isValidIinBin, 'Invalid ИИН').nullish(),
  noIin: z.boolean().optional(),
  birthDate: dateStr.nullish(),
  gender: z.enum(GENDERS).nullish(),
  channels: z.array(z.enum(CONTACT_CHANNELS)).min(1).max(3),
  email: email.nullish(),
  phone: phone.nullish(),
  comment: optText(2000),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  responsibleUserId: id.nullish(),
  departmentId: id.nullish(),
  positionId: id.nullish(),
  plannedHireDate: dateStr.nullish(),
});

type CandidateRuleInput = { iin?: string | null; noIin?: boolean; channels?: string[]; email?: string | null; phone?: string | null };

/** Cross-field rules: ИИН unless noIin, email for EMAIL, phone for SMS/WHATSAPP. Returns field → message. */
export function candidateRuleErrors(c: CandidateRuleInput): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!c.noIin && !c.iin) errors.iin = 'ИИН обязателен (или отметьте «ИИН отсутствует»)';
  const ch = c.channels ?? [];
  if (ch.includes('EMAIL') && !c.email) errors.email = 'Email обязателен для канала EMAIL';
  if ((ch.includes('SMS') || ch.includes('WHATSAPP')) && !c.phone) errors.phone = 'Телефон обязателен для каналов SMS/WhatsApp';
  if (new Set(ch).size !== ch.length) errors.channels = 'Каналы не должны повторяться';
  return errors;
}

export const CandidateInput = CandidateBase.superRefine((c, ctx) => {
  for (const [path, message] of Object.entries(candidateRuleErrors(c))) ctx.addIssue({ code: 'custom', path: [path], message });
});
export type CandidateInput = z.infer<typeof CandidateInput>;

export const CandidateUpdate = CandidateBase.partial().extend({ status: z.enum(CANDIDATE_STATUSES).optional() });
export type CandidateUpdate = z.infer<typeof CandidateUpdate>;

/** Comma-separated multi-value filter (`?status=NEW,IN_PROGRESS`). */
const enumList = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : v.split(',')).map((s) => s.trim()).filter(Boolean))
    .pipe(z.array(z.enum(values)).min(1));

export const CandidateFilter = pageQuery.extend({
  q: z.string().trim().max(100).optional(),
  status: enumList(CANDIDATE_STATUSES).optional(),
  invitationStatus: enumList(INVITATION_STATUSES).optional(),
  docRequestStatus: enumList(DOC_REQUEST_STATUSES).optional(),
  checkStatus: enumList(CANDIDATE_CHECKS).optional(),
  responsibleUserId: id.optional(),
  legalEntityId: id.optional(),
  tag: z.string().trim().max(40).optional(),
  updatedFrom: dateStr.optional(),
  updatedTo: dateStr.optional(),
  sort: z.enum(['updatedAt', 'lastName', 'createdAt']).default('updatedAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export const RequestDocumentsInput = z.object({ candidateIds: z.array(id).min(1).max(200), requestTemplateId: id });
export const CandidateCommentInput = z.object({ text: z.string().trim().min(1).max(2000) });
export const DocValuesInput = z.object({ values: z.record(z.string().max(60), z.unknown()) });
export const ReviewInput = z
  .object({
    decision: z.enum(['ACCEPT', 'RETURN', 'REJECT']),
    comment: z.string().trim().max(2000).optional(),
    checkStatus: z.enum(CANDIDATE_CHECKS).optional(),
    returnDocIds: z.array(id).max(50).optional(),
  })
  .superRefine((r, ctx) => {
    if (r.decision === 'RETURN') {
      if (!r.comment) ctx.addIssue({ code: 'custom', path: ['comment'], message: 'Укажите комментарий для доработки' });
      if (!r.returnDocIds?.length) ctx.addIssue({ code: 'custom', path: ['returnDocIds'], message: 'Выберите документы для доработки' });
    }
  });
export type ReviewInput = z.infer<typeof ReviewInput>;

export const HireInput = z.object({
  legalEntityId: id,
  departmentId: id,
  positionId: id,
  managerId: id.nullish(),
  locationId: id.nullish(),
  hireDate: dateStr,
  tabNumber: z.string().trim().regex(/^[0-9A-Za-zА-Яа-я-]{1,20}$/, 'Invalid tab number').optional(),
  salary: z.number().positive().max(1_000_000_000),
  probationMonths: z.number().int().min(0).max(6).optional(),
  generateDocuments: z.boolean(),
});
export type HireInput = z.infer<typeof HireInput>;

export const CandidateExportInput = z.object({
  candidateIds: z.array(id).min(1).max(1000).optional(),
  format: z.enum(['json', 'xml', 'xlsx']),
  markExported: z.boolean(),
});

// ── Templates ──
export const FormField = z
  .object({
    key: z.string().trim().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,59}$/, 'Use latin letters, digits and _'),
    label: name(200),
    labelKk: z.string().trim().max(200).optional(),
    type: z.enum(FORM_FIELD_TYPES),
    required: z.boolean(),
    options: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
  })
  .superRefine((f, ctx) => {
    if (f.type === 'select' && !f.options?.length) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Select field needs options' });
  });
export type FormField = z.infer<typeof FormField>;

const uniqueKeys = (fields: { key: string }[]) => new Set(fields.map((f) => f.key)).size === fields.length;

export const QuestionnaireInput = z.object({
  name: name(200),
  fields: z.array(FormField).min(1).max(100).refine(uniqueKeys, 'Field keys must be unique'),
});
export type QuestionnaireInput = z.infer<typeof QuestionnaireInput>;

export const RequestTemplateItemInput = z.object({ personalDocTypeId: id, required: z.boolean(), fieldKeys: z.array(z.string().max(60)).max(100) });
export const RequestTemplateInput = z.object({
  name: name(200),
  questionnaireTemplateId: id.nullish(),
  items: z
    .array(RequestTemplateItemInput)
    .min(1)
    .max(50)
    .refine((items) => new Set(items.map((i) => i.personalDocTypeId)).size === items.length, 'Document types must be unique'),
});
export type RequestTemplateInput = z.infer<typeof RequestTemplateInput>;

// ── Portal (API.md §6) ──
export const PortalRequestCodeInput = z.object({ login: z.string().trim().min(3).max(200) });
export const PortalVerifyInput = z.object({ login: z.string().trim().min(3).max(200), code: z.string().regex(/^\d{6}$/) });
export const QuestionnaireAnswersInput = z.object({ answers: z.record(z.string().max(60), z.unknown()) });
export const AutofillReplyInput = z.object({ reply: z.enum(['511', '512']) });
