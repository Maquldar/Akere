import { z } from 'zod';
import { boolQuery, dateStr, id, pageQuery } from '../validators';

export const DOCUMENT_KINDS = ['GENERIC', 'CONTRACT', 'SUPPLEMENTARY', 'ORDER', 'APPLICATION', 'VND', 'ARCHIVE'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export const DOCUMENT_STATUSES = ['DRAFT', 'IN_ROUTE', 'REWORK', 'COMPLETED', 'REJECTED', 'CANCELLED'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];
export const STEP_ACTIONS = ['APPROVE', 'SIGN', 'ACKNOWLEDGE'] as const;
export type StepAction = (typeof STEP_ACTIONS)[number];
export const STEP_STATUSES = ['WAITING', 'PENDING', 'DONE', 'REJECTED', 'RETURNED', 'SKIPPED'] as const;
export const SIGN_METHODS = ['EGOV_MOBILE', 'EGOV_BUSINESS', 'NCALAYER', 'PAPER', 'CLICK'] as const;
export type SignMethod = (typeof SIGN_METHODS)[number];
export const ASSIGNEE_RULES = ['USER', 'ROLE_HR', 'MANAGER_OF_SUBJECT', 'SUBJECT', 'SIGNATORY', 'AUTHOR'] as const;
export type AssigneeRule = (typeof ASSIGNEE_RULES)[number];
export const DOCUMENT_BOXES = ['inbox', 'outbox', 'drafts', 'all', 'archive'] as const;

const text = (max: number) => z.string().trim().min(1).max(max);

export const TemplateBlock = z.discriminatedUnion('type', [
  z.object({ type: z.literal('heading'), text: text(500), align: z.enum(['left', 'center']).optional() }),
  z.object({ type: z.literal('paragraph'), text: text(10_000) }),
  z.object({ type: z.literal('fields'), rows: z.array(z.object({ label: text(200), value: z.string().max(2000) })).min(1).max(60) }),
  z.object({ type: z.literal('signatures'), parties: z.array(z.object({ label: text(200), name: z.string().max(300) })).min(1).max(4) }),
  z.object({ type: z.literal('spacer') }),
]);
export type TemplateBlock = z.infer<typeof TemplateBlock>;

export const DocumentTemplateInput = z.object({ name: text(200), body: z.array(TemplateBlock).min(1).max(300) });
export const TemplatePreviewInput = z.object({ data: z.record(z.string(), z.unknown()).default({}), subjectEmployeeId: id.nullish(), legalEntityId: id });

export const RouteStepDef = z.object({
  order: z.number().int().min(1).max(50),
  action: z.enum(STEP_ACTIONS),
  rule: z.enum(ASSIGNEE_RULES),
  userId: id.optional(),
  dueDays: z.number().int().min(0).max(365).optional(),
}).refine((s) => s.rule !== 'USER' || !!s.userId, { message: 'userId is required for rule USER', path: ['userId'] });
export type RouteStepDef = z.infer<typeof RouteStepDef>;
export const RouteTemplateInput = z.object({ name: text(200), steps: z.array(RouteStepDef).min(1).max(30) });

export const DocumentTypeInput = z.object({
  code: z.string().trim().regex(/^[A-Z0-9_]{2,50}$/, 'Use A-Z, 0-9 and _'),
  name: text(200),
  nameKk: z.string().trim().max(200).nullish(),
  kind: z.enum(DOCUMENT_KINDS),
  numberPattern: z.string().trim().min(1).max(60).refine((p) => p.includes('{seq}'), 'Pattern must contain {seq}').default('{seq}-{MM}/{YY}'),
  templateId: id.nullish(),
  routeTemplateId: id.nullish(),
  esutdRequired: z.boolean().default(false),
  isActive: z.boolean().default(true),
});
export const DocumentTypeUpdate = DocumentTypeInput.partial();
export const DocumentTypeFilter = z.object({ kind: z.enum(DOCUMENT_KINDS).optional(), active: boolQuery.optional() });

const dataRecord = z.record(z.string(), z.unknown());

export const DocumentCreate = z.object({
  documentTypeId: id,
  legalEntityId: id,
  title: z.string().trim().min(1).max(300).optional(),
  subjectEmployeeId: id.nullish(),
  data: dataRecord.default({}),
  dueAt: z.iso.datetime().nullish(),
  startRoute: z.boolean().default(false),
});
export const DocumentBulkCreate = z.object({
  documentTypeId: id,
  legalEntityId: id,
  subjectEmployeeIds: z.array(id).min(1).max(50),
  data: dataRecord.default({}),
  dueAt: z.iso.datetime().nullish(),
  startRoute: z.boolean().default(false),
});
export const DocumentUpdate = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  data: dataRecord.optional(),
  dueAt: z.iso.datetime().nullish(),
});
export const DocumentFilter = pageQuery.extend({
  box: z.enum(DOCUMENT_BOXES).default('all'),
  q: z.string().trim().max(200).optional(),
  kind: z.enum(DOCUMENT_KINDS).optional(),
  documentTypeId: id.optional(),
  status: z.enum(DOCUMENT_STATUSES).optional(),
  legalEntityId: id.optional(),
  subjectEmployeeId: id.optional(),
  authorId: id.optional(),
  dateFrom: dateStr.optional(),
  dateTo: dateStr.optional(),
  overdue: boolQuery.optional(),
  sort: z.enum(['createdAt', 'number', 'dueAt']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});
export const DocumentCancelInput = z.object({ reason: text(2000) });
export const DocumentRegisterInput = z.object({ number: z.string().trim().min(1).max(60).optional(), registeredAt: dateStr.optional() });
export const DocumentApproveInput = z.object({ comment: z.string().trim().max(2000).optional() });
export const DocumentReturnInput = z.object({ comment: text(2000) });
export const DocumentBulkIds = z.object({ documentIds: z.array(id).min(1).max(200) });
export const DocumentCommentInput = z.object({ text: text(4000) });
export const DocumentLinkInput = z.object({ toId: id, relation: z.string().trim().regex(/^[A-Z_]{2,40}$/, 'Use A-Z and _') });

export const SigningSessionCreate = z.object({
  documentIds: z.array(id).min(1).max(100),
  method: z.enum(['EGOV_MOBILE', 'EGOV_BUSINESS', 'NCALAYER']),
});
export const SigningConfirmInput = z.object({ decision: z.enum(['SIGN', 'DECLINE']) });
export const NcaLayerInput = z.object({ pin: z.string().min(4).max(32) });
