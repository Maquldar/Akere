import type { Prisma, Request, RequestStatus, RequestType } from '@prisma/client';
import type { FormField, RequestInput, TemplateBlock } from '@akere/shared';
import { prisma, type Tx } from '../../lib/db';
import type { UserCtx } from '../../lib/auth';
import { AppError, businessRule, conflict, fieldError, forbidden, notFound } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { notify } from '../../lib/notify';
import { hrLegalEntityIds, isHrOrAdmin, managerSubtree } from '../../lib/scope';
import { toFileRef } from '../../lib/files';
import { toUserRef, userRefSelect, type UserRef } from '../../lib/names';
import { fromDateStr, optDateStr, toDateStr } from '../../lib/dates';
import { tenantTimezone, todayLocal } from '../../lib/calendar';
import { buildTemplateContext, renderPlainPdf, renderTemplatePdf } from '../../lib/templates';
import { activePrincipalIds } from '../deputies/service';
import { getVacationBalance } from '../employees/service';
import { canReadDocument, createDocument, getDocumentDetail, updateDocument } from '../documents/service';
import { startRoute } from '../documents/route-engine';
import { assertAttachableFiles } from '../uploads/service';
import { hasDates } from './types';
import { fmtShort, leaveDays } from './days';

// ───────────────────────── Constants ─────────────────────────

/** Requests that hold their dates (count for overlaps). Drafts, rejected and cancelled ones do not. */
export const HOLDING: RequestStatus[] = ['IN_APPROVAL', 'REWORK', 'ORDER_SIGNING', 'COMPLETED'];
/** Requests whose vacation days are reserved but not yet written to the ledger. */
const RESERVING: RequestStatus[] = ['IN_APPROVAL', 'REWORK', 'ORDER_SIGNING'];
const TERMINAL: RequestStatus[] = ['COMPLETED', 'REJECTED', 'CANCELLED'];
const REQUEST_LINK = (id: string) => `/requests/${id}`;

type ReqRow = Request & { requestType: RequestType };

// ───────────────────────── Input normalization ─────────────────────────

/** Keeps only the type's declared fields; trims strings, coerces numbers/checkboxes. */
export function cleanData(type: RequestType, data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of (type.fields ?? []) as FormField[]) {
    const v = data[f.key];
    if (v === undefined || v === null || v === '') continue;
    if (f.type === 'number') {
      const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
      if (!Number.isFinite(n)) throw fieldError(`data.${f.key}`, 'Expected a number');
      out[f.key] = n;
    } else if (f.type === 'checkbox') out[f.key] = v === true || v === 'true';
    else {
      const s = String(v).trim().slice(0, 2000);
      if (f.type === 'select' && f.options?.length && !f.options.includes(s)) throw fieldError(`data.${f.key}`, 'Unknown option');
      if (s) out[f.key] = s;
    }
  }
  return out;
}

/** Own fresh uploads only (see assertAttachableFiles); a request may keep files it already references. */
async function assertAttachments(u: UserCtx, ids: string[], tx: Tx = prisma, exceptRequestId?: string) {
  await assertAttachableFiles(u, ids, { fail: () => fieldError('attachmentFileIds', 'Unknown attachment'), exceptRequestId }, tx);
}

async function loadType(tenantId: string, requestTypeId: string, tx: Tx = prisma) {
  const t = await tx.requestType.findFirst({ where: { id: requestTypeId, tenantId } });
  if (!t || !t.isActive) throw notFound('Request type');
  return t;
}

async function ownEmployee(u: UserCtx, tx: Tx = prisma) {
  if (!u.employeeId) throw businessRule('NO_EMPLOYEE_RECORD', 'Only employees can file requests');
  return tx.employee.findUniqueOrThrow({ where: { id: u.employeeId } });
}

// ───────────────────────── Rules ─────────────────────────

type Draft = { type: RequestType; employeeId: string; startDate: string | null; endDate: string | null; data: Record<string, unknown>; attachmentFileIds: string[] };

/** Vacation days reserved by the employee's other annual-leave requests still in progress. */
async function reservedDays(employeeId: string, excludeId: string | null, tx: Tx = prisma) {
  const agg = await tx.request.aggregate({
    where: { employeeId, status: { in: RESERVING }, requestType: { usesVacationBalance: true }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    _sum: { days: true },
  });
  return agg._sum.days ?? 0;
}

async function overlaps(d: Draft, excludeId: string | null, tx: Tx = prisma) {
  if (!d.startDate || !d.endDate) return [];
  const s = fromDateStr(d.startDate);
  const e = fromDateStr(d.endDate);
  const [reqs, abs] = await Promise.all([
    tx.request.findMany({
      where: { employeeId: d.employeeId, status: { in: HOLDING }, startDate: { lte: e }, endDate: { gte: s }, ...(excludeId ? { id: { not: excludeId } } : {}) },
      include: { requestType: { select: { name: true } } },
    }),
    tx.absence.findMany({
      where: { employeeId: d.employeeId, startDate: { lte: e }, endDate: { gte: s }, ...(excludeId ? { NOT: { source: 'REQUEST', sourceId: excludeId } } : {}) },
    }),
  ]);
  const reqIds = new Set(reqs.map((r) => r.id));
  return [
    ...reqs.map((r) => ({ kind: 'REQUEST' as const, id: r.id, label: r.requestType.name, startDate: toDateStr(r.startDate!), endDate: toDateStr(r.endDate!) })),
    ...abs.filter((a) => !(a.source === 'REQUEST' && a.sourceId && reqIds.has(a.sourceId)))
      .map((a) => ({ kind: 'ABSENCE' as const, id: a.id, label: a.kind, startDate: toDateStr(a.startDate), endDate: toDateStr(a.endDate) })),
  ];
}

export type Evaluation = {
  days: number | null; available: number | null; balanceAfter: number | null; holidays: { date: string; name: string }[];
  overlaps: Awaited<ReturnType<typeof overlaps>>; pastStart: boolean; missingFields: string[]; missingAttachment: boolean;
};

/** Computes days/balance and collects every rule violation without throwing (used by preview and submit). */
export async function evaluate(u: UserCtx, d: Draft, excludeId: string | null, tx: Tx = prisma): Promise<Evaluation> {
  const dated = hasDates(d.type);
  let days: number | null = null;
  let holidays: { date: string; name: string }[] = [];
  if (dated && d.startDate && d.endDate) {
    const r = await leaveDays(d.startDate, d.endDate, d.type.absenceKind, tx);
    days = r.days;
    holidays = r.holidays.map((h) => ({ date: h.date, name: h.name }));
  }
  let available: number | null = null;
  let balanceAfter: number | null = null;
  if (d.type.usesVacationBalance) {
    const bal = await getVacationBalance(d.employeeId, tx);
    available = Math.round((bal.available - (await reservedDays(d.employeeId, excludeId, tx))) * 100) / 100;
    balanceAfter = Math.round((available - (days ?? 0)) * 100) / 100;
  }
  const today = todayLocal(await tenantTimezone(u.tenantId, tx));
  const missingFields = ((d.type.fields ?? []) as FormField[]).filter((f) => f.required && (d.data[f.key] === undefined || d.data[f.key] === '')).map((f) => f.key);
  return {
    days, available, balanceAfter, holidays,
    overlaps: dated ? await overlaps(d, excludeId, tx) : [],
    pastStart: dated && !!d.startDate && d.startDate < today,
    missingFields,
    missingAttachment: d.type.requiresAttachment && d.attachmentFileIds.length === 0,
  };
}

/** Throws the first broken rule (API.md §8 Rules). */
export async function assertSubmittable(u: UserCtx, d: Draft, excludeId: string | null, tx: Tx = prisma): Promise<Evaluation> {
  if (hasDates(d.type)) {
    if (!d.startDate) throw fieldError('startDate', 'Start date is required');
    if (!d.endDate) throw fieldError('endDate', 'End date is required');
    if (d.endDate < d.startDate) throw fieldError('endDate', 'endDate must not be before startDate');
  }
  const ev = await evaluate(u, d, excludeId, tx);
  if (ev.missingFields.length) throw fieldError(`data.${ev.missingFields[0]}`, 'Required');
  if (ev.days === 0) throw businessRule('NO_LEAVE_DAYS', 'The period consists of public holidays only');
  if (ev.pastStart && !isHrOrAdmin(u)) throw businessRule('PAST_START_DATE', 'Only HR can file a request starting in the past');
  if (ev.missingAttachment) throw businessRule('ATTACHMENT_REQUIRED', 'A supporting document must be attached');
  if (ev.overlaps.length) throw businessRule('OVERLAP', 'The dates overlap with another request or absence', { overlaps: ev.overlaps });
  if (ev.available !== null && (ev.days ?? 0) > ev.available) {
    throw businessRule('INSUFFICIENT_VACATION_BALANCE', `Not enough vacation days: ${ev.available} available, ${ev.days} requested`, { available: ev.available, requested: ev.days });
  }
  return ev;
}

export function warningsFor(ev: Evaluation, d: Draft, u: UserCtx): string[] {
  const w: string[] = [];
  if (d.type.usesVacationBalance && ev.days !== null && ev.days > 0 && ev.days < 14) {
    w.push('Одна из частей ежегодного отпуска должна составлять не менее 14 календарных дней (ст. 94 ТК РК).');
  }
  if (ev.available !== null && ev.days !== null && ev.days > ev.available) w.push(`Недостаточно дней отпуска: доступно ${ev.available}, запрошено ${ev.days}.`);
  if (ev.holidays.length) w.push(`Праздничные дни не включаются в отпуск: ${ev.holidays.map((h) => `${fmtShort(h.date)} (${h.name})`).join(', ')}.`);
  for (const o of ev.overlaps) w.push(`Даты пересекаются: ${o.label} ${fmtShort(o.startDate)}–${fmtShort(o.endDate)}.`);
  if (ev.pastStart) w.push(isHrOrAdmin(u) ? 'Дата начала в прошлом.' : 'Дата начала в прошлом: такую заявку может оформить только HR.');
  if (ev.days === 0) w.push('Период состоит только из праздничных дней.');
  if (ev.missingAttachment) w.push('Приложите подтверждающий документ.');
  return w;
}

/** Data passed to the application/order templates (keys match the seeded templates' variables). */
function documentData(r: { startDate: string | null; endDate: string | null; days: number | null; data: Record<string, unknown> }, requestId?: string) {
  return {
    ...r.data,
    ...(r.startDate ? { startDate: r.startDate } : {}),
    ...(r.endDate ? { endDate: r.endDate } : {}),
    ...(r.days !== null ? { days: r.days } : {}),
    ...(requestId ? { requestId } : {}),
  };
}

const draftOf = (r: ReqRow): Draft => ({
  type: r.requestType, employeeId: r.employeeId, startDate: optDateStr(r.startDate), endDate: optDateStr(r.endDate),
  data: (r.data ?? {}) as Record<string, unknown>, attachmentFileIds: r.attachmentFileIds,
});

// ───────────────────────── Preview ─────────────────────────

export async function previewRequest(u: UserCtx, input: RequestInput, excludeId: string | null) {
  const emp = await ownEmployee(u);
  const type = await loadType(u.tenantId, input.requestTypeId);
  const d: Draft = {
    type, employeeId: emp.id, startDate: hasDates(type) ? input.startDate ?? null : null, endDate: hasDates(type) ? input.endDate ?? null : null,
    data: cleanData(type, input.data), attachmentFileIds: input.attachmentFileIds,
  };
  const ev = await evaluate(u, d, excludeId);
  const docType = await prisma.documentType.findUniqueOrThrow({ where: { id: type.applicationDocTypeId }, include: { template: true } });
  const ctx = await buildTemplateContext({
    legalEntityId: emp.legalEntityId, subjectEmployeeId: emp.id, authorUserId: u.userId, documentTypeId: docType.id,
    document: { number: null, title: docType.name },
    data: documentData({ startDate: d.startDate, endDate: d.endDate, days: ev.days, data: d.data }),
  });
  const bytes = docType.template ? await renderTemplatePdf(docType.template.body as TemplateBlock[], ctx, docType.name) : await renderPlainPdf(ctx);
  return { days: ev.days ?? 0, balanceAfter: ev.balanceAfter, pdfDataUrl: `data:application/pdf;base64,${bytes.toString('base64')}`, warnings: warningsFor(ev, d, u) };
}

// ───────────────────────── Create / update / submit / cancel ─────────────────────────

export async function createRequest(tx: Tx, u: UserCtx, input: RequestInput): Promise<string> {
  const emp = await ownEmployee(u, tx);
  const type = await loadType(u.tenantId, input.requestTypeId, tx);
  await assertAttachments(u, input.attachmentFileIds, tx);
  const dated = hasDates(type);
  const startDate = dated ? input.startDate ?? null : null;
  const endDate = dated ? input.endDate ?? null : null;
  const days = startDate && endDate ? (await leaveDays(startDate, endDate, type.absenceKind, tx)).days : null;
  const r = await tx.request.create({
    data: {
      tenantId: u.tenantId, employeeId: emp.id, requestTypeId: type.id, status: 'DRAFT',
      startDate: startDate ? fromDateStr(startDate) : null, endDate: endDate ? fromDateStr(endDate) : null, days,
      data: cleanData(type, input.data) as Prisma.InputJsonValue, attachmentFileIds: [...new Set(input.attachmentFileIds)],
    },
  });
  await audit(u, 'request.create', 'Request', r.id, { type: type.code }, { tx });
  if (input.submit) await submitRequest(tx, u, r.id);
  return r.id;
}

async function loadOwned(tx: Tx, u: UserCtx, id: string): Promise<ReqRow> {
  const r = await tx.request.findFirst({ where: { id, tenantId: u.tenantId }, include: { requestType: true } });
  if (!r || !(await canReadRequest(u, r))) throw notFound('Request');
  if (!u.employeeId || r.employeeId !== u.employeeId) throw forbidden('Only the author can change this request');
  return r;
}

export async function updateRequest(tx: Tx, u: UserCtx, id: string, input: RequestInput) {
  const r = await loadOwned(tx, u, id);
  if (r.status !== 'DRAFT' && r.status !== 'REWORK') throw conflict(`Request in status ${r.status} cannot be edited`, { rule: 'INVALID_STATUS' });
  if (input.requestTypeId !== r.requestTypeId && r.applicationDocumentId) throw businessRule('TYPE_LOCKED', 'The request type cannot be changed after submission');
  const type = input.requestTypeId === r.requestTypeId ? r.requestType : await loadType(u.tenantId, input.requestTypeId, tx);
  await assertAttachments(u, input.attachmentFileIds, tx, r.id);
  const dated = hasDates(type);
  const startDate = dated ? input.startDate ?? null : null;
  const endDate = dated ? input.endDate ?? null : null;
  const days = startDate && endDate ? (await leaveDays(startDate, endDate, type.absenceKind, tx)).days : null;
  const data = cleanData(type, input.data);
  await tx.request.update({
    where: { id: r.id },
    data: {
      requestTypeId: type.id, startDate: startDate ? fromDateStr(startDate) : null, endDate: endDate ? fromDateStr(endDate) : null, days,
      data: data as Prisma.InputJsonValue, attachmentFileIds: [...new Set(input.attachmentFileIds)],
    },
  });
  if (r.applicationDocumentId) {
    const doc = await tx.document.findUnique({ where: { id: r.applicationDocumentId }, select: { status: true } });
    if (doc?.status === 'REWORK') await updateDocument(tx, r.applicationDocumentId, u.userId, { data: documentData({ startDate, endDate, days, data }, r.id) });
  }
  await audit(u, 'request.update', 'Request', r.id, {}, { tx });
  if (input.submit) await submitRequest(tx, u, r.id);
}

/** DRAFT/REWORK → IN_APPROVAL: validates, creates (or updates and restarts) the application document. */
export async function submitRequest(tx: Tx, u: UserCtx, id: string) {
  const owner = await tx.request.findFirst({ where: { id, tenantId: u.tenantId }, select: { employeeId: true } });
  // Serialize submissions per employee: balance/overlap checks and the reservation must not interleave (M1).
  if (owner) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`request-submit:${owner.employeeId}`}))`;
  const r = await loadOwned(tx, u, id);
  if (r.status !== 'DRAFT' && r.status !== 'REWORK') throw conflict(`Request in status ${r.status} cannot be submitted`, { rule: 'INVALID_STATUS' });
  const d = draftOf(r);
  const ev = await assertSubmittable(u, d, r.id, tx);
  const data = documentData({ startDate: d.startDate, endDate: d.endDate, days: ev.days, data: d.data }, r.id);
  const emp = await tx.employee.findUniqueOrThrow({ where: { id: r.employeeId } });
  const existing = r.applicationDocumentId ? await tx.document.findUnique({ where: { id: r.applicationDocumentId } }) : null;
  let docId: string;
  const resubmit = existing?.status === 'REWORK' || existing?.status === 'DRAFT';
  if (existing && resubmit) {
    docId = existing.id;
    await updateDocument(tx, docId, u.userId, { data });
  } else {
    docId = await createDocument(tx, {
      tenantId: u.tenantId, authorUserId: u.userId, documentTypeId: r.requestType.applicationDocTypeId, legalEntityId: emp.legalEntityId,
      subjectEmployeeId: emp.id, data,
    });
  }
  // Link first so a route that completes immediately still reaches the request hooks.
  await tx.request.update({ where: { id: r.id }, data: { status: 'IN_APPROVAL', submittedAt: new Date(), applicationDocumentId: docId, days: ev.days } });
  await audit(u, resubmit ? 'request.resubmit' : 'request.submit', 'Request', r.id, { documentId: docId }, { tx });
  await startRoute(tx, docId, u.userId);
}

/** Owner cancels before completion; open documents of the request are cancelled too. */
export async function cancelRequest(tx: Tx, u: UserCtx, id: string) {
  const r = await loadOwned(tx, u, id);
  if (TERMINAL.includes(r.status)) throw conflict(`Request in status ${r.status} cannot be cancelled`, { rule: 'INVALID_STATUS' });
  for (const docId of [r.applicationDocumentId, r.orderDocumentId]) {
    if (!docId) continue;
    const doc = await tx.document.findUnique({ where: { id: docId } });
    if (!doc || ['COMPLETED', 'CANCELLED', 'REJECTED'].includes(doc.status)) continue;
    await tx.routeStep.updateMany({ where: { documentId: docId, status: { in: ['WAITING', 'PENDING'] } }, data: { status: 'SKIPPED' } });
    await tx.document.update({ where: { id: docId }, data: { status: 'CANCELLED', currentStepOrder: null } });
    await tx.documentComment.create({ data: { documentId: docId, authorId: u.userId, text: 'Документ отменён: работник отозвал заявку' } });
    await audit(u, 'document.cancel', 'Document', docId, { reason: 'request cancelled' }, { tx });
  }
  await tx.request.update({ where: { id: r.id }, data: { status: 'CANCELLED' } });
  await audit(u, 'request.cancel', 'Request', r.id, {}, { tx });
}

// ───────────────────────── Document hooks → request state machine ─────────────────────────

async function requestByDoc(tx: Tx, documentId: string) {
  return tx.request.findFirst({
    where: { OR: [{ applicationDocumentId: documentId }, { orderDocumentId: documentId }] },
    include: { requestType: true, employee: { select: { userId: true, legalEntityId: true } } },
  });
}

async function notifyEmployee(tx: Tx, r: { id: string; tenantId: string; employee: { userId: string }; requestType: { name: string } }, title: string, body: string) {
  await notify({ tenantId: r.tenantId, userId: r.employee.userId, type: 'request.status', title, body: `${r.requestType.name}: ${body}`, link: REQUEST_LINK(r.id) }, tx);
}

/** COMPLETED: absence for dated leave/trip types, ledger USAGE for annual leave. Idempotent. */
export async function completeRequest(tx: Tx, requestId: string) {
  const r = await tx.request.findUniqueOrThrow({ where: { id: requestId }, include: { requestType: true, employee: { select: { userId: true } } } });
  if (r.status === 'COMPLETED') return;
  await tx.request.update({ where: { id: r.id }, data: { status: 'COMPLETED', completedAt: new Date() } });
  const t = r.requestType;
  if (t.absenceKind && r.startDate && r.endDate && !(await tx.absence.findFirst({ where: { source: 'REQUEST', sourceId: r.id } }))) {
    await tx.absence.create({
      data: { tenantId: r.tenantId, employeeId: r.employeeId, kind: t.absenceKind, startDate: r.startDate, endDate: r.endDate, source: 'REQUEST', sourceId: r.id, note: t.name },
    });
  }
  if (t.usesVacationBalance && r.days && !(await tx.vacationLedger.findFirst({ where: { requestId: r.id, type: 'USAGE' } }))) {
    await tx.vacationLedger.create({
      data: {
        tenantId: r.tenantId, employeeId: r.employeeId, type: 'USAGE', days: r.days, date: r.startDate ?? new Date(), requestId: r.id,
        note: `${t.name} ${fmtShort(toDateStr(r.startDate!))}–${fmtShort(toDateStr(r.endDate!))}`,
      },
    });
  }
  await audit({ tenantId: r.tenantId }, 'request.completed', 'Request', r.id, {}, { tx });
  await notifyEmployee(tx, r, 'Заявка исполнена', t.absenceKind ? 'приказ подписан, отсутствие внесено в график' : 'заявка выполнена');
}

/** Application approved → order generated, linked (ORDER_FOR) and routed; types without an order complete right away. */
async function onApplicationCompleted(tx: Tx, r: NonNullable<Awaited<ReturnType<typeof requestByDoc>>>) {
  const t = r.requestType;
  if (!t.orderDocTypeId) return completeRequest(tx, r.id);
  const app = await tx.document.findUniqueOrThrow({ where: { id: r.applicationDocumentId! }, include: { steps: { where: { status: 'DONE' }, orderBy: [{ order: 'desc' }, { actedAt: 'desc' }] } } });
  // The order is authored by whoever approved last (HR); fallback: the application's author.
  const author = app.steps[0]?.actedById ?? app.authorId;
  const orderId = await createDocument(tx, {
    tenantId: r.tenantId, authorUserId: author, documentTypeId: t.orderDocTypeId, legalEntityId: app.legalEntityId,
    subjectEmployeeId: r.employeeId, data: app.data as Record<string, unknown>,
  });
  await tx.documentLink.create({ data: { fromId: orderId, toId: app.id, relation: 'ORDER_FOR' } });
  await tx.request.update({ where: { id: r.id }, data: { status: 'ORDER_SIGNING', orderDocumentId: orderId } });
  await audit({ tenantId: r.tenantId, userId: author }, 'request.order_created', 'Request', r.id, { documentId: orderId }, { tx });
  try {
    await startRoute(tx, orderId, author);
  } catch (e) {
    // No signatory configured: the order stays a draft for HR to complete the route manually.
    if (!(e instanceof AppError)) throw e;
  }
  await notifyEmployee(tx, r, 'Заявка согласована', 'приказ сформирован и направлен на подписание');
}

export async function handleDocumentCompleted(tx: Tx, documentId: string) {
  const r = await requestByDoc(tx, documentId);
  if (!r || TERMINAL.includes(r.status)) return;
  if (r.applicationDocumentId === documentId) await onApplicationCompleted(tx, r);
  else await completeRequest(tx, r.id);
}

export async function handleDocumentRejected(tx: Tx, documentId: string) {
  const r = await requestByDoc(tx, documentId);
  if (!r || TERMINAL.includes(r.status)) return;
  await tx.request.update({ where: { id: r.id }, data: { status: 'REJECTED' } });
  await audit({ tenantId: r.tenantId }, 'request.rejected', 'Request', r.id, { documentId }, { tx });
  const doc = await tx.document.findUnique({ where: { id: documentId }, select: { authorId: true } });
  // The document author (the employee for applications) is already notified by the route engine.
  if (doc?.authorId !== r.employee.userId) await notifyEmployee(tx, r, 'Заявка отклонена', 'приказ отклонён');
}

/** A cancelled application or order (from the documents module) cancels the request. */
export async function handleDocumentCancelled(tx: Tx, documentId: string) {
  const r = await requestByDoc(tx, documentId);
  if (!r || TERMINAL.includes(r.status)) return;
  await tx.request.update({ where: { id: r.id }, data: { status: 'CANCELLED' } });
  await audit({ tenantId: r.tenantId }, 'request.cancelled', 'Request', r.id, { documentId }, { tx });
}

export async function handleDocumentReturned(tx: Tx, documentId: string) {
  const r = await requestByDoc(tx, documentId);
  if (!r || r.applicationDocumentId !== documentId || r.status !== 'IN_APPROVAL') return;
  await tx.request.update({ where: { id: r.id }, data: { status: 'REWORK' } });
  await audit({ tenantId: r.tenantId }, 'request.rework', 'Request', r.id, { documentId }, { tx });
}

// ───────────────────────── Visibility ─────────────────────────

/** Documents where the user is (or deputises for) a route participant. */
async function participantDocIds(u: UserCtx, tx: Tx = prisma) {
  const principals = await activePrincipalIds(u.userId, tx);
  const steps = await tx.routeStep.findMany({
    where: { OR: [{ assigneeUserId: { in: [u.userId, ...principals] } }, { actedById: u.userId }], document: { tenantId: u.tenantId, kind: { in: ['APPLICATION', 'ORDER'] } } },
    select: { documentId: true }, distinct: ['documentId'], take: 5000,
  });
  return steps.map((s) => s.documentId);
}

/**
 * request.read scope: the owner (incl. drafts); for submitted requests also HR of the employee's legal entity,
 * managers of the employee (subtree) and route participants of the request's documents. ADMIN: tenant.
 */
export async function requestScope(u: UserCtx, tx: Tx = prisma): Promise<Prisma.RequestWhereInput> {
  const base: Prisma.RequestWhereInput = { tenantId: u.tenantId };
  const own: Prisma.RequestWhereInput = { employeeId: u.employeeId ?? '__none__' };
  const le = hrLegalEntityIds(u);
  if (le === null) return { ...base, OR: [own, { status: { not: 'DRAFT' } }] };
  const others: Prisma.RequestWhereInput[] = [];
  if (le.length) others.push({ employee: { legalEntityId: { in: le } } });
  const subtree = await managerSubtree(u);
  if (subtree.length) others.push({ employeeId: { in: subtree } });
  const docs = await participantDocIds(u, tx);
  if (docs.length) others.push({ applicationDocumentId: { in: docs } }, { orderDocumentId: { in: docs } });
  return { ...base, OR: [own, ...(others.length ? [{ status: { not: 'DRAFT' as const }, OR: others }] : [])] };
}

/** Same rules as requestScope, evaluated for one request with targeted queries (no participant id list). */
export async function canReadRequest(
  u: UserCtx,
  r: { id: string; tenantId?: string; employeeId: string; status: RequestStatus; applicationDocumentId?: string | null; orderDocumentId?: string | null },
) {
  if (u.employeeId && r.employeeId === u.employeeId) return true;
  if (r.status === 'DRAFT') return false;
  const row = r.tenantId !== undefined && r.applicationDocumentId !== undefined && r.orderDocumentId !== undefined
    ? { tenantId: r.tenantId, applicationDocumentId: r.applicationDocumentId, orderDocumentId: r.orderDocumentId }
    : await prisma.request.findUnique({ where: { id: r.id }, select: { tenantId: true, applicationDocumentId: true, orderDocumentId: true } });
  if (!row || row.tenantId !== u.tenantId) return false;
  const le = hrLegalEntityIds(u);
  if (le === null) return true;
  if (le.length && (await prisma.employee.count({ where: { id: r.employeeId, legalEntityId: { in: le } } }))) return true;
  if ((await managerSubtree(u)).includes(r.employeeId)) return true;
  const docIds = [row.applicationDocumentId, row.orderDocumentId].filter((x): x is string => !!x);
  if (!docIds.length) return false;
  const principals = await activePrincipalIds(u.userId);
  const step = await prisma.routeStep.findFirst({
    where: {
      documentId: { in: docIds }, document: { tenantId: u.tenantId, kind: { in: ['APPLICATION', 'ORDER'] } },
      OR: [{ assigneeUserId: { in: [u.userId, ...principals] } }, { actedById: u.userId }],
    },
    select: { id: true },
  });
  return !!step;
}

/** where-clause for the list `scope` parameter. */
export async function listScope(u: UserCtx, scope: 'mine' | 'team' | 'all'): Promise<Prisma.RequestWhereInput> {
  if (scope === 'mine') return { tenantId: u.tenantId, employeeId: u.employeeId ?? '__none__' };
  if (scope === 'team') {
    const subtree = await managerSubtree(u);
    return { tenantId: u.tenantId, status: { not: 'DRAFT' }, employeeId: { in: subtree } };
  }
  const le = hrLegalEntityIds(u);
  if (le !== null && le.length === 0) throw forbidden('Only HR can list all requests');
  return { tenantId: u.tenantId, status: { not: 'DRAFT' }, ...(le ? { employee: { legalEntityId: { in: le } } } : {}) };
}

// ───────────────────────── Views ─────────────────────────

export const requestInclude = {
  requestType: true,
  employee: { select: { id: true, legalEntityId: true, user: { select: userRefSelect } } },
} satisfies Prisma.RequestInclude;
type ViewRow = Prisma.RequestGetPayload<{ include: typeof requestInclude }>;

export function toListItem(r: ViewRow) {
  return {
    id: r.id,
    type: { id: r.requestType.id, name: r.requestType.name, code: r.requestType.code },
    employee: { ...toUserRef(r.employee.user), employeeId: r.employee.id },
    status: r.status,
    startDate: optDateStr(r.startDate),
    endDate: optDateStr(r.endDate),
    days: r.days,
    createdAt: r.createdAt.toISOString(),
    submittedAt: r.submittedAt?.toISOString() ?? null,
  };
}

const AUDIT_LABELS: Record<string, string> = {
  'request.create': 'Заявка создана',
  'request.submit': 'Заявка отправлена на согласование',
  'request.resubmit': 'Заявка повторно отправлена после доработки',
  'request.rework': 'Заявка возвращена на доработку',
  'request.rejected': 'Заявка отклонена',
  'request.order_created': 'Сформирован приказ',
  'request.completed': 'Заявка исполнена',
  'request.cancel': 'Заявка отменена',
};

function stepLabel(kind: 'APPLICATION' | 'ORDER', s: { action: string; status: string; order: number }) {
  if (s.status === 'RETURNED') return 'Возвращено на доработку';
  if (s.status === 'REJECTED') return kind === 'ORDER' ? 'Приказ отклонён' : 'Отклонено';
  if (kind === 'ORDER') return s.action === 'ACKNOWLEDGE' ? 'Работник ознакомлен с приказом' : 'Приказ подписан';
  return s.action === 'APPROVE' ? 'Согласовано' : 'Подписано';
}

async function timeline(r: ViewRow, tx: Tx = prisma) {
  const logs = await tx.auditLog.findMany({ where: { tenantId: r.tenantId, entityType: 'Request', entityId: r.id, action: { in: Object.keys(AUDIT_LABELS) } }, orderBy: { createdAt: 'asc' } });
  const docIds = [r.applicationDocumentId, r.orderDocumentId].filter((x): x is string => !!x);
  const steps = docIds.length
    ? await tx.routeStep.findMany({ where: { documentId: { in: docIds }, actedAt: { not: null }, status: { in: ['DONE', 'RETURNED', 'REJECTED'] } } })
    : [];
  const userIds = [...new Set([...logs.map((l) => l.actorUserId), ...steps.map((s) => s.actedById)].filter((x): x is string => !!x))];
  const users = new Map((await tx.user.findMany({ where: { id: { in: userIds } }, select: userRefSelect })).map((x) => [x.id, toUserRef(x)]));
  const ref = (id: string | null | undefined): UserRef | null => (id ? users.get(id) ?? null : null);
  const items = [
    ...logs.map((l) => ({ at: l.createdAt.toISOString(), label: AUDIT_LABELS[l.action]!, actor: ref(l.actorUserId) })),
    ...steps.map((s) => {
      const label = stepLabel(s.documentId === r.orderDocumentId ? 'ORDER' : 'APPLICATION', s);
      return { at: s.actedAt!.toISOString(), label: s.comment ? `${label}: ${s.comment}` : label, actor: ref(s.actedById) };
    }),
  ];
  return items.sort((a, b) => a.at.localeCompare(b.at));
}

export async function getRequestDetail(u: UserCtx, id: string) {
  const r = await prisma.request.findFirst({ where: { id, tenantId: u.tenantId }, include: requestInclude });
  if (!r || !(await canReadRequest(u, r))) throw notFound('Request');
  const doc = async (docId: string | null) => (docId && (await canReadDocument(u, docId)) ? getDocumentDetail(u, docId) : null);
  const files = r.attachmentFileIds.length ? await prisma.storedFile.findMany({ where: { id: { in: r.attachmentFileIds } }, orderBy: { createdAt: 'asc' } }) : [];
  const owner = !!u.employeeId && r.employeeId === u.employeeId;
  const balance = r.requestType.usesVacationBalance ? (await getVacationBalance(r.employeeId)).available : null;
  return {
    ...toListItem(r),
    data: (r.data ?? {}) as Record<string, unknown>,
    applicationDocument: await doc(r.applicationDocumentId),
    orderDocument: await doc(r.orderDocumentId),
    attachments: files.map((f) => toFileRef(f)),
    timeline: await timeline(r),
    completedAt: r.completedAt?.toISOString() ?? null,
    vacationBalance: balance,
    canEdit: owner && (r.status === 'DRAFT' || r.status === 'REWORK'),
    canSubmit: owner && (r.status === 'DRAFT' || r.status === 'REWORK'),
    canCancel: owner && !TERMINAL.includes(r.status),
  };
}

/** Sidebar badge: application documents waiting for my approval (directly or as an active deputy). */
export async function pendingApprovalCount(u: UserCtx, tx: Tx = prisma) {
  const principals = await activePrincipalIds(u.userId, tx);
  return tx.routeStep.count({
    where: { status: 'PENDING', assigneeUserId: { in: [u.userId, ...principals] }, document: { tenantId: u.tenantId, status: 'IN_ROUTE', kind: 'APPLICATION' } },
  });
}

