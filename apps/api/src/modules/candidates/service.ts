import type { Candidate, ContactChannel, DocRequestStatus, Prisma } from '@prisma/client';
import { candidateRuleErrors } from '@akere/shared';
import { config } from '../../config';
import { prisma, type Tx } from '../../lib/db';
import { can, type UserCtx } from '../../lib/auth';
import { AppError, conflict, fieldError, notFound } from '../../lib/errors';
import { registerFileAccess, toFileRef } from '../../lib/files';
import { canReadEmployee, hrLegalEntityIds, legalEntityAllowed } from '../../lib/scope';
import { fullName, toUserRef, userRefSelect, type UserRef } from '../../lib/names';
import { optDateStr } from '../../lib/dates';
import { defineMessages, tx as tr } from '../../lib/i18n';
import { messaging } from '../../adapters/messaging';
import { docTypeView, questionnaireView, visibleFields, type FormFieldDef } from '../onboarding/service';

defineMessages({
  'candidate.invite.subject': { ru: '{company}: запрос документов для оформления', kk: '{company}: рәсімдеуге арналған құжаттар сұрауы', en: '{company}: documents request' },
  'candidate.invite.text': {
    ru: 'Здравствуйте, {name}! {company} приглашает вас заполнить данные и загрузить документы для оформления на работу. Перейдите по ссылке {url} и войдите по одноразовому коду.',
    kk: 'Сәлеметсіз бе, {name}! {company} сізді жұмысқа рәсімделу үшін деректерді толтыруға және құжаттарды жүктеуге шақырады. {url} сілтемесі бойынша өтіп, бір реттік кодпен кіріңіз.',
    en: 'Hello {name}! {company} invites you to fill in your data and upload documents for employment. Open {url} and sign in with a one-time code.',
  },
  'candidate.returned.subject': { ru: '{company}: документы возвращены на доработку', kk: '{company}: құжаттар пысықтауға қайтарылды', en: '{company}: documents returned for rework' },
  'candidate.returned.text': {
    ru: 'Здравствуйте, {name}! Кадровый специалист вернул документы на доработку: {comment}. Исправьте их по ссылке {url}.',
    kk: 'Сәлеметсіз бе, {name}! Кадр маманы құжаттарды пысықтауға қайтарды: {comment}. Оларды {url} сілтемесі бойынша түзетіңіз.',
    en: 'Hello {name}! HR returned your documents for rework: {comment}. Please fix them at {url}.',
  },
  'candidate.accepted.subject': { ru: '{company}: документы приняты', kk: '{company}: құжаттар қабылданды', en: '{company}: documents accepted' },
  'candidate.accepted.text': {
    ru: 'Здравствуйте, {name}! Ваши документы проверены и приняты. Кадровый специалист свяжется с вами для оформления.',
    kk: 'Сәлеметсіз бе, {name}! Құжаттарыңыз тексеріліп, қабылданды. Кадр маманы рәсімдеу үшін сізбен хабарласады.',
    en: 'Hello {name}! Your documents have been reviewed and accepted. HR will contact you to complete onboarding.',
  },
  'candidate.rejected.subject': { ru: '{company}: решение по кандидатуре', kk: '{company}: кандидатура бойынша шешім', en: '{company}: application decision' },
  'candidate.rejected.text': {
    ru: 'Здравствуйте, {name}! К сожалению, {company} не может продолжить оформление. Спасибо за интерес к компании.',
    kk: 'Сәлеметсіз бе, {name}! Өкінішке қарай, {company} рәсімдеуді жалғастыра алмайды. Компанияға қызығушылық танытқаныңызға рахмет.',
    en: 'Hello {name}! Unfortunately {company} cannot continue your onboarding. Thank you for your interest.',
  },
  'candidate.submitted.title': { ru: 'Кандидат {name} загрузил документы', kk: '{name} кандидаты құжаттарды жүктеді', en: 'Candidate {name} submitted documents' },
  'candidate.submitted.body': { ru: 'Пакет документов готов к проверке.', kk: 'Құжаттар топтамасы тексеруге дайын.', en: 'The document package is ready for review.' },
});

// ── Scope ──
export function candidateScope(u: UserCtx): Prisma.CandidateWhereInput {
  const le = hrLegalEntityIds(u);
  return { tenantId: u.tenantId, ...(le === null ? {} : { legalEntityId: { in: le } }) };
}

export async function findCandidate(u: UserCtx, id: string) {
  const c = await prisma.candidate.findFirst({ where: { AND: [candidateScope(u), { id }] } });
  if (!c) throw notFound('Candidate');
  return c;
}

// ── Candidate views ──
export const candidateInclude = {
  legalEntity: { select: { id: true, name: true } },
  department: { select: { id: true, name: true } },
  position: { select: { id: true, name: true } },
  _count: { select: { comments: true } },
} as const satisfies Prisma.CandidateInclude;
export type CandidateRow = Prisma.CandidateGetPayload<{ include: typeof candidateInclude }>;

export async function userRefs(ids: (string | null | undefined)[]): Promise<Map<string, UserRef>> {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))];
  if (!uniq.length) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: uniq } }, select: userRefSelect });
  return new Map(users.map((u) => [u.id, toUserRef(u)]));
}

export const toListItem = (c: CandidateRow, refs: Map<string, UserRef>) => ({
  id: c.id,
  fullName: fullName(c),
  status: c.status,
  invitationStatus: c.invitationStatus,
  docRequestStatus: c.docRequestStatus,
  checkStatus: c.checkStatus,
  responsible: c.responsibleUserId ? (refs.get(c.responsibleUserId) ?? null) : null,
  legalEntity: c.legalEntity,
  commentsCount: c._count.comments,
  tags: c.tags,
  updatedAt: c.updatedAt.toISOString(),
});

export const toDetail = (c: CandidateRow, refs: Map<string, UserRef>) => ({
  ...toListItem(c, refs),
  legalEntityId: c.legalEntityId,
  lastName: c.lastName,
  firstName: c.firstName,
  middleName: c.middleName,
  iin: c.iin,
  noIin: c.noIin,
  birthDate: optDateStr(c.birthDate),
  gender: c.gender,
  channels: c.channels,
  email: c.email,
  phone: c.phone,
  comment: c.comment,
  responsibleUserId: c.responsibleUserId,
  departmentId: c.departmentId,
  positionId: c.positionId,
  plannedHireDate: optDateStr(c.plannedHireDate),
  createdAt: c.createdAt.toISOString(),
  employeeId: c.employeeId,
  exportedAt: c.exportedAt?.toISOString() ?? null,
  position: c.position,
  department: c.department,
});

export async function loadDetail(id: string) {
  const c = await prisma.candidate.findUniqueOrThrow({ where: { id }, include: candidateInclude });
  return toDetail(c, await userRefs([c.responsibleUserId]));
}

/** Validates the merged candidate against the cross-field rules and tenant references. */
export async function validateCandidate(
  u: UserCtx,
  c: {
    legalEntityId: string; iin?: string | null; noIin?: boolean; channels: string[]; email?: string | null; phone?: string | null;
    responsibleUserId?: string | null; departmentId?: string | null; positionId?: string | null;
  },
  selfId?: string,
) {
  const errs = candidateRuleErrors(c);
  if (Object.keys(errs).length) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Validation failed', { fieldErrors: Object.fromEntries(Object.entries(errs).map(([k, v]) => [k, [v]])), formErrors: [] });
  }
  if (!(await prisma.legalEntity.findFirst({ where: { id: c.legalEntityId, tenantId: u.tenantId } }))) throw notFound('Legal entity');
  if (!legalEntityAllowed(u, c.legalEntityId)) throw new AppError(403, 'FORBIDDEN', 'Legal entity is outside your scope');
  if (c.departmentId && !(await prisma.department.findFirst({ where: { id: c.departmentId, tenantId: u.tenantId, legalEntityId: c.legalEntityId } }))) {
    throw fieldError('departmentId', 'Department does not belong to the legal entity');
  }
  if (c.positionId && !(await prisma.position.findFirst({ where: { id: c.positionId, tenantId: u.tenantId } }))) throw fieldError('positionId', 'Unknown position');
  if (c.responsibleUserId) {
    const r = await prisma.user.findFirst({ where: { id: c.responsibleUserId, tenantId: u.tenantId, isActive: true, roles: { some: { role: { in: ['HR', 'ADMIN'] } } } } });
    if (!r) throw fieldError('responsibleUserId', 'Responsible must be an active HR specialist or administrator');
  }
  if (c.iin && !c.noIin) {
    const dup = await prisma.candidate.findFirst({
      where: { tenantId: u.tenantId, iin: c.iin, status: { not: 'BLOCKED' }, employeeId: null, ...(selfId ? { id: { not: selfId } } : {}) },
      select: { id: true },
    });
    if (dup) throw conflict('A candidate with this ИИН already exists', { candidateId: dup.id, field: 'iin' });
  }
}

// ── Document request views ──
export const requestInclude = {
  template: { select: { id: true, name: true, questionnaire: true } },
  documents: { include: { docType: true, files: { orderBy: { createdAt: 'asc' } } }, orderBy: { docType: { sortOrder: 'asc' } } },
} as const satisfies Prisma.DocumentRequestInclude;
export type RequestRow = Prisma.DocumentRequestGetPayload<{ include: typeof requestInclude }>;
export type DocRow = RequestRow['documents'][number];

export const docView = (d: DocRow, portal = false) => ({
  id: d.id,
  docType: docTypeView(d.docType),
  required: d.required,
  fieldKeys: (d.fieldKeys ?? []) as string[],
  status: d.status,
  values: (d.values ?? {}) as Record<string, unknown>,
  autoFilledKeys: d.autoFilledKeys,
  files: d.files.map((f) => toFileRef(f, portal)),
  returnComment: d.returnComment,
});

export const requestView = (r: RequestRow, portal = false) => ({
  id: r.id,
  status: r.status,
  consentStatus: r.consentStatus,
  template: { id: r.template.id, name: r.template.name },
  questionnaire: r.template.questionnaire ? questionnaireView(r.template.questionnaire) : null,
  questionnaireAnswers: (r.questionnaireAnswers ?? {}) as Record<string, unknown>,
  documents: r.documents.map((d) => docView(d, portal)),
  readyAt: r.readyAt?.toISOString() ?? null,
  reviewedAt: r.reviewedAt?.toISOString() ?? null,
  reviewComment: r.reviewComment,
  createdAt: r.createdAt.toISOString(),
});

export const latestRequest = (candidateId: string, db: Tx = prisma) =>
  db.documentRequest.findFirst({ where: { candidateId }, orderBy: { createdAt: 'desc' }, include: requestInclude });

export const loadRequest = (id: string, db: Tx = prisma) => db.documentRequest.findUniqueOrThrow({ where: { id }, include: requestInclude });

// ── Field values ──
const isEmpty = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

function coerce(f: FormFieldDef, v: unknown): { value: unknown } | { error: string } {
  if (isEmpty(v)) return { value: null };
  switch (f.type) {
    case 'text':
    case 'textarea': {
      if (typeof v !== 'string' && typeof v !== 'number') return { error: 'Expected text' };
      const s = String(v).trim();
      if (s.length > (f.type === 'text' ? 500 : 5000)) return { error: 'Too long' };
      return { value: s };
    }
    case 'number': {
      const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.')) : NaN;
      return Number.isFinite(n) ? { value: n } : { error: 'Expected a number' };
    }
    case 'date': {
      if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) return { error: 'Expected YYYY-MM-DD' };
      return { value: v };
    }
    case 'select': {
      if (typeof v !== 'string') return { error: 'Expected an option' };
      if (f.options?.length && !f.options.includes(v)) return { error: `Allowed: ${f.options.join(', ')}` };
      return { value: v };
    }
    case 'checkbox': {
      if (typeof v === 'boolean') return { value: v };
      if (v === 'true' || v === 'false') return { value: v === 'true' };
      return { error: 'Expected true/false' };
    }
    case 'file':
      return typeof v === 'string' && v.length <= 64 ? { value: v } : { error: 'Expected a file id' };
  }
}

/** Validates input values against the allowed fields; returns the merged values. Throws 400 with per-field errors. */
export function mergeValues(fields: FormFieldDef[], current: Record<string, unknown>, input: Record<string, unknown>, prefix = 'values') {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const fieldErrors: Record<string, string[]> = {};
  const next: Record<string, unknown> = { ...current };
  const changed: string[] = [];
  for (const [k, raw] of Object.entries(input)) {
    const f = byKey.get(k);
    if (!f) {
      fieldErrors[`${prefix}.${k}`] = ['Unknown field'];
      continue;
    }
    const r = coerce(f, raw);
    if ('error' in r) {
      fieldErrors[`${prefix}.${k}`] = [r.error];
      continue;
    }
    if (JSON.stringify(current[k] ?? null) !== JSON.stringify(r.value)) changed.push(k);
    if (r.value === null) delete next[k];
    else next[k] = r.value;
  }
  if (Object.keys(fieldErrors).length) throw new AppError(400, 'VALIDATION_ERROR', 'Validation failed', { fieldErrors, formErrors: [] });
  return { values: next, changed };
}

/** A document counts as provided when it has a file, or all its required fields (at least one value if none are required). PHOTO needs a file. */
export function docCompleteness(d: { docType: { code: string; fields: unknown }; fieldKeys: unknown; values: unknown; files: unknown[] }) {
  const fields = visibleFields((d.docType.fields ?? []) as FormFieldDef[], (d.fieldKeys ?? []) as string[]).filter((f) => f.type !== 'file');
  const values = (d.values ?? {}) as Record<string, unknown>;
  const hasFile = d.files.length > 0;
  if (d.docType.code === 'PHOTO' || fields.length === 0) return { complete: hasFile, missing: hasFile ? [] : ['file'] };
  if (hasFile) return { complete: true, missing: [] as string[] };
  const required = fields.filter((f) => f.required);
  const missing = required.filter((f) => isEmpty(values[f.key])).map((f) => f.key);
  if (required.length === 0) {
    const any = fields.some((f) => !isEmpty(values[f.key]));
    return { complete: any, missing: any ? [] : ['file'] };
  }
  return { complete: missing.length === 0, missing };
}

/** Doc status after an edit: ACCEPTED/RETURNED stay until review/submit; otherwise FILLED when complete. */
export function statusAfterEdit(d: Parameters<typeof docCompleteness>[0] & { status: string }) {
  if (d.status === 'ACCEPTED' || d.status === 'RETURNED') return d.status;
  return docCompleteness(d).complete ? 'FILLED' : 'PENDING';
}

export async function refreshDocStatus(docId: string, db: Tx = prisma) {
  const d = await db.candidateDocument.findUniqueOrThrow({ where: { id: docId }, include: { docType: true, files: true } });
  const status = statusAfterEdit(d) as DocRow['status'];
  if (status !== d.status) await db.candidateDocument.update({ where: { id: d.id }, data: { status } });
}

export async function setRequestStatus(requestId: string, candidateId: string, status: DocRequestStatus, db: Tx = prisma, extra: Prisma.DocumentRequestUpdateInput = {}) {
  await db.documentRequest.update({ where: { id: requestId }, data: { status, ...extra } });
  await db.candidate.update({ where: { id: candidateId }, data: { docRequestStatus: status } });
}

// ── Messaging ──
export function portalLink(c: Pick<Candidate, 'email' | 'phone'>, channel: ContactChannel) {
  const login = channel === 'EMAIL' ? c.email : c.phone;
  return `${config.APP_URL}/ru/portal${login ? `?login=${encodeURIComponent(login)}` : ''}`;
}

/** Sends a message through every channel the candidate selected (F-49). Failures are recorded in the outbox, never thrown. */
export async function sendToCandidate(
  c: Pick<Candidate, 'tenantId' | 'channels' | 'email' | 'phone' | 'firstName'>,
  key: 'invite' | 'returned' | 'accepted' | 'rejected',
  params: { company: string; comment?: string },
  lang = 'ru',
) {
  for (const channel of c.channels) {
    const to = channel === 'EMAIL' ? c.email : c.phone;
    if (!to) continue;
    const vars = { name: c.firstName, company: params.company, comment: params.comment ?? '', url: portalLink(c, channel) };
    const text = tr(key === 'invite' ? 'candidate.invite.text' : `candidate.${key}.text`, lang, vars);
    const subject = tr(key === 'invite' ? 'candidate.invite.subject' : `candidate.${key}.subject`, lang, vars);
    await messaging(channel).send({ tenantId: c.tenantId, to, subject, text }).catch(() => undefined);
  }
}

// ── Personal data for export / hire ──
type DocValues = Record<string, Record<string, unknown>>;
const s = (v: unknown) => (v === undefined || v === null || v === '' ? null : String(v));

export async function acceptedValues(candidateId: string): Promise<{ values: DocValues; photoFileId: string | null; request: RequestRow | null }> {
  const r = await latestRequest(candidateId);
  const values: DocValues = {};
  let photoFileId: string | null = null;
  for (const d of r?.documents ?? []) {
    values[d.docType.code] = (d.values ?? {}) as Record<string, unknown>;
    if (d.docType.code === 'PHOTO') photoFileId = d.files.find((f) => f.mime.startsWith('image/'))?.id ?? null;
  }
  return { values, photoFileId, request: r };
}

export function formatAddress(a: Record<string, unknown> | undefined): string | null {
  if (!a || !Object.keys(a).length) return null;
  const parts = [s(a.country), s(a.region), s(a.district), s(a.city), s(a.street), a.building ? `д. ${a.building}` : null, a.block ? `корп. ${a.block}` : null, a.apartment ? `кв. ${a.apartment}` : null];
  return parts.filter(Boolean).join(', ');
}

export function personalData(values: DocValues) {
  const id = values.ID_CARD ?? {};
  const pp = values.PASSPORT ?? {};
  const edu = values.EDUCATION;
  const iban = values.IBAN;
  const idDoc = Object.keys(id).length
    ? { type: 'Удостоверение личности гражданина РК', number: s(id.docNumber), issueDate: s(id.issueDate), expiryDate: s(id.expiryDate), issuedBy: s(id.issuedBy) }
    : Object.keys(pp).length
      ? { type: 'Паспорт', number: s(pp.docNumber), issueDate: s(pp.issueDate), expiryDate: s(pp.expiryDate), issuedBy: s(pp.issuedBy) }
      : null;
  return {
    citizenship: s(id.citizenship),
    nationality: s(id.nationality),
    birthPlace: s(id.birthPlace),
    address: formatAddress(values.ADDRESS),
    addressParts: values.ADDRESS ?? null,
    idDocument: idDoc,
    education: edu ? { category: s(edu.category), institution: s(edu.institution), specialty: s(edu.specialty), docNumber: s(edu.docNumber), endDate: s(edu.endDate) } : null,
    bank: iban ? { bank: s(iban.bank), iban: s(iban.iban), bic: s(iban.bic) } : null,
  };
}

/** CandidateDocumentView[] of an employee's onboarding package (for GET /employees/:id/personal-documents). */
export async function personalDocumentsForEmployee(tenantId: string, employeeId: string) {
  const c = await prisma.candidate.findFirst({ where: { tenantId, employeeId }, select: { id: true } });
  if (!c) return [];
  const r = await latestRequest(c.id);
  return r ? r.documents.map((d) => docView(d)) : [];
}

// ── File access (lib/files registry) ──
registerFileAccess(async (ctx, file) => {
  if (!file.candidateDocumentId) return false;
  const doc = await prisma.candidateDocument.findUnique({
    where: { id: file.candidateDocumentId },
    select: { request: { select: { tenantId: true, candidate: { select: { id: true, legalEntityId: true, employeeId: true } } } } },
  });
  if (!doc || doc.request.tenantId !== ctx.tenantId) return false;
  const c = doc.request.candidate;
  if (ctx.kind === 'candidate') return c.id === ctx.candidateId;
  if (can(ctx, 'candidate.read') && legalEntityAllowed(ctx, c.legalEntityId)) return true;
  if (c.employeeId) return ctx.employeeId === c.employeeId || (await canReadEmployee(ctx, c.employeeId));
  return false;
});
