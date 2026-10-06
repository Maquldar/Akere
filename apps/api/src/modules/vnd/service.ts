import type { Prisma } from '@prisma/client';
import type { VndDetail, VndListItem, VndRecipientStatus, VndStatus } from '@akere/shared';
import { prisma, type Tx } from '../../lib/db';
import type { UserCtx } from '../../lib/auth';
import { businessRule, conflict, notFound } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { notify } from '../../lib/notify';
import { fileUrl, saveFile, saveGenerated } from '../../lib/files';
import { PdfBuilder } from '../../lib/pdf';
import { toUserRef, userRefSelect } from '../../lib/names';
import { todayUtc } from '../../lib/dates';
import { hrLegalEntityIds, isHrOrAdmin, legalEntityAllowed, managedEmployeeScope } from '../../lib/scope';
import { ensureDocumentType } from '../documents/defaults';
import { refreshSearchText, registerNumber } from '../documents/numbering';
import { activateNext, inTx, signAndComplete } from '../documents/route-engine';

/**
 * ВНД (F-34) — internal regulations sent to employees for acknowledgment.
 *
 * Design: a ВНД is a Document of kind VND. On send, every recipient gets an ACKNOWLEDGE RouteStep (order 1, all parallel),
 * so the existing signing pipeline (/signing/sessions → eGov QR / NCALayer → signAndComplete) works unchanged: the recipient
 * signs SHA-256 of the ВНД PDF with their sandbox key, the step becomes DONE with a Signature, and when the last step is done
 * the route engine completes the document (signed PDF with the signature sheet, `document.completed`).
 * VndRecipient rows mirror the steps (status/acknowledgedAt/signatureId) via syncAcknowledgments(), which runs after an
 * acknowledgment, on `document.completed` and before every read, so acknowledgments made through any path stay consistent.
 * Document.data: { requireSignature: boolean, sentAt?: ISO, fileName }. registeredAt = send date (used by date filters).
 */

export type VndData = { requireSignature?: boolean; sentAt?: string; fileName?: string };
export const vndData = (d: { data: unknown }) => (d.data ?? {}) as VndData;

// ───────────── Scope ─────────────

/** VND documents the user may read: HR/ADMIN of the legal entity or the author (all statuses); recipients (once sent). */
export function vndScope(u: UserCtx): Prisma.DocumentWhereInput {
  const base: Prisma.DocumentWhereInput = { tenantId: u.tenantId, kind: 'VND', status: { in: ['DRAFT', 'IN_ROUTE', 'COMPLETED'] } };
  const or: Prisma.DocumentWhereInput[] = [{ authorId: u.userId }];
  const le = isHrOrAdmin(u) ? hrLegalEntityIds(u) : [];
  if (le === null) return base;
  if (le.length) or.push({ legalEntityId: { in: le } });
  if (u.employeeId) or.push({ status: { not: 'DRAFT' }, vndRecipients: { some: { employeeId: u.employeeId } } });
  return { ...base, OR: or };
}

/** True when the user manages the ВНД (HR of its legal entity or its author with vnd.manage). */
export const canManageVnd = (u: UserCtx, d: { legalEntityId: string; authorId: string }) =>
  u.permissions.includes('vnd.manage') && ((isHrOrAdmin(u) && legalEntityAllowed(u, d.legalEntityId)) || d.authorId === u.userId);

export async function getReadableVnd(u: UserCtx, id: string, tx: Tx = prisma) {
  const doc = await tx.document.findFirst({ where: { AND: [vndScope(u), { id }] } });
  if (!doc) throw notFound('ВНД');
  return doc;
}

export async function getManageableVnd(u: UserCtx, id: string, tx: Tx = prisma) {
  const doc = await getReadableVnd(u, id, tx);
  if (!canManageVnd(u, doc)) throw notFound('ВНД');
  return doc;
}

// ───────────── Acknowledgment sync ─────────────

/** Mirrors DONE ACKNOWLEDGE steps into VndRecipient rows (status, acknowledgedAt, signatureId). */
export async function syncAcknowledgments(tx: Tx, filter: { documentId?: string; tenantId?: string }): Promise<number> {
  if (filter.documentId) {
    return tx.$executeRaw`
      UPDATE "VndRecipient" r SET status = 'ACKNOWLEDGED', "acknowledgedAt" = s."actedAt", "signatureId" = sig.id
      FROM "RouteStep" s
      JOIN "Employee" e ON e."userId" = s."assigneeUserId"
      LEFT JOIN "Signature" sig ON sig."routeStepId" = s.id
      WHERE r."documentId" = ${filter.documentId} AND s."documentId" = r."documentId" AND e.id = r."employeeId"
        AND s.action = 'ACKNOWLEDGE' AND s.status = 'DONE' AND r.status = 'PENDING'`;
  }
  return tx.$executeRaw`
    UPDATE "VndRecipient" r SET status = 'ACKNOWLEDGED', "acknowledgedAt" = s."actedAt", "signatureId" = sig.id
    FROM "RouteStep" s
    JOIN "Document" d ON d.id = s."documentId"
    JOIN "Employee" e ON e."userId" = s."assigneeUserId"
    LEFT JOIN "Signature" sig ON sig."routeStepId" = s.id
    WHERE d."tenantId" = ${filter.tenantId ?? ''} AND d.kind = 'VND' AND s."documentId" = r."documentId" AND e.id = r."employeeId"
      AND s.action = 'ACKNOWLEDGE' AND s.status = 'DONE' AND r.status = 'PENDING'`;
}

// ───────────── Views ─────────────

const vndInclude = {
  documentType: { select: { id: true, name: true } },
  legalEntity: { select: { id: true, name: true } },
  files: { orderBy: { createdAt: 'asc' }, take: 1, include: { versions: { orderBy: { version: 'desc' }, take: 1 } } },
  _count: { select: { comments: true } },
} satisfies Prisma.DocumentInclude;
type VndRow = Prisma.DocumentGetPayload<{ include: typeof vndInclude }>;

const viewStatus = (s: string): VndStatus => (s === 'COMPLETED' ? 'COMPLETED' : s === 'IN_ROUTE' ? 'IN_ROUTE' : 'DRAFT');

async function toItems(rows: VndRow[], viewerEmployeeId: string | null): Promise<(VndListItem & { _row: VndRow })[]> {
  const ids = rows.map((r) => r.id);
  const groups = ids.length
    ? await prisma.vndRecipient.groupBy({ by: ['documentId', 'status'], where: { documentId: { in: ids } }, _count: { _all: true } })
    : [];
  const mine = viewerEmployeeId && ids.length
    ? new Map((await prisma.vndRecipient.findMany({ where: { documentId: { in: ids }, employeeId: viewerEmployeeId }, select: { documentId: true, status: true } })).map((r) => [r.documentId, r.status]))
    : new Map<string, VndRecipientStatus>();
  return rows.map((d) => {
    const g = groups.filter((x) => x.documentId === d.id);
    const total = g.reduce((s, x) => s + x._count._all, 0);
    const acknowledged = g.find((x) => x.status === 'ACKNOWLEDGED')?._count._all ?? 0;
    const my = mine.get(d.id);
    return {
      id: d.id, number: d.number, title: d.title, type: d.documentType, sentAt: vndData(d).sentAt ?? null, acknowledged, total,
      status: viewStatus(d.status), commentsCount: d._count.comments, legalEntity: d.legalEntity,
      ...(my ? { myStatus: my } : {}),
      _row: d,
    };
  });
}

export async function listVnd(u: UserCtx, where: Prisma.DocumentWhereInput, page: { skip: number; take: number }) {
  await syncAcknowledgments(prisma, { tenantId: u.tenantId });
  const full: Prisma.DocumentWhereInput = { AND: [vndScope(u), where] };
  const [rows, total] = await Promise.all([
    prisma.document.findMany({ where: full, include: vndInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...page }),
    prisma.document.count({ where: full }),
  ]);
  const items = (await toItems(rows, u.employeeId)).map(({ _row, ...rest }) => rest);
  return { items, total };
}

export async function myVnd(u: UserCtx, status?: VndRecipientStatus): Promise<VndListItem[]> {
  if (!u.employeeId) return [];
  await syncAcknowledgments(prisma, { tenantId: u.tenantId });
  const rows = await prisma.document.findMany({
    where: {
      tenantId: u.tenantId, kind: 'VND', status: { in: ['IN_ROUTE', 'COMPLETED'] },
      vndRecipients: { some: { employeeId: u.employeeId, ...(status ? { status } : {}) } },
    },
    include: vndInclude,
    orderBy: [{ createdAt: 'desc' }],
    take: 500,
  });
  const items = (await toItems(rows, u.employeeId)).map(({ _row, ...rest }) => rest);
  // Pending first, then by send date.
  return items.sort((a, b) => Number(a.myStatus === 'ACKNOWLEDGED') - Number(b.myStatus === 'ACKNOWLEDGED') || (b.sentAt ?? '').localeCompare(a.sentAt ?? ''));
}

export async function vndDetail(u: UserCtx, id: string): Promise<VndDetail & { canManage: boolean; canAcknowledge: boolean; pdfUrl: string | null; signedPdfUrl: string | null; fileName: string | null }> {
  await syncAcknowledgments(prisma, { documentId: id });
  const d = await prisma.document.findFirst({ where: { AND: [vndScope(u), { id }] }, include: vndInclude });
  if (!d) throw notFound('ВНД');
  const [item] = await toItems([d], u.employeeId);
  const author = await prisma.user.findUniqueOrThrow({ where: { id: d.authorId }, select: userRefSelect });
  const version = d.files[0]?.versions[0];
  const { _row, ...rest } = item!;
  return {
    ...rest,
    fileUrl: version ? fileUrl(version.storedFileId) : d.pdfFileId ? fileUrl(d.pdfFileId) : '',
    fileName: vndData(d).fileName ?? null,
    pdfUrl: d.pdfFileId ? `/api/v1/documents/${d.id}/pdf` : null,
    signedPdfUrl: d.signedPdfFileId ? `/api/v1/documents/${d.id}/pdf?signed=true` : null,
    dueAt: d.dueAt?.toISOString() ?? null,
    author: toUserRef(author),
    requireSignature: vndData(d).requireSignature !== false,
    createdAt: d.createdAt.toISOString(),
    canManage: canManageVnd(u, d),
    canAcknowledge: d.status === 'IN_ROUTE' && rest.myStatus === 'PENDING',
  };
}

// ───────────── Create ─────────────

/** PDF that stands in for a .docx ВНД in the signing pipeline: it embeds the SHA-256 of the original file, so signing it binds the docx. */
async function coverPdf(title: string, legalEntity: string, fileName: string, sha: string) {
  const pdf = await PdfBuilder.create({ title, footer: `Akere HR · ВНД · ${legalEntity}` });
  await pdf.add([
    { type: 'heading', text: title, align: 'center' },
    { type: 'paragraph', text: legalEntity, align: 'center' },
    { type: 'spacer' },
    { type: 'banner', text: 'Лист для ознакомления с внутренним нормативным документом', color: 'blue' },
    { type: 'paragraph', text: 'Текст документа приложен в формате Microsoft Word. Подписывая этот лист, работник подтверждает, что ознакомлен с документом, контрольная сумма которого указана ниже.' },
    { type: 'fields', rows: [{ label: 'Файл', value: fileName }, { label: 'SHA-256', value: sha }] },
  ]);
  return pdf.bytes();
}

export async function createVnd(
  u: UserCtx,
  input: { title: string; legalEntityId: string; documentTypeId?: string; dueAt?: Date | null; requireSignature: boolean; file: { filename: string; buffer: Buffer } },
): Promise<string> {
  const le = await prisma.legalEntity.findFirst({ where: { id: input.legalEntityId, tenantId: u.tenantId } });
  if (!le) throw notFound('Legal entity');
  if (!legalEntityAllowed(u, le.id)) throw notFound('Legal entity');
  let typeId: string;
  if (input.documentTypeId) {
    const t = await prisma.documentType.findFirst({ where: { id: input.documentTypeId, tenantId: u.tenantId } });
    if (!t) throw notFound('Document type');
    if (t.kind !== 'VND') throw businessRule('NOT_VND_TYPE', 'The document type must be of kind VND');
    if (!t.isActive) throw businessRule('DOCUMENT_TYPE_INACTIVE', 'Document type is inactive');
    typeId = t.id;
  } else typeId = (await ensureDocumentType(u.tenantId, 'VND')).id;

  return prisma.$transaction(async (tx) => {
    const stored = await saveFile({ tenantId: u.tenantId, buffer: input.file.buffer, filename: input.file.filename, allowed: ['pdf', 'docx'], uploadedById: u.userId }, tx);
    const pdfFileId = stored.mime === 'application/pdf'
      ? stored.id
      : (await saveGenerated(u.tenantId, await coverPdf(input.title, le.name, stored.filename, stored.sha256), `${input.title.slice(0, 120)}.pdf`, 'application/pdf', tx)).id;
    const data: VndData = { requireSignature: input.requireSignature, fileName: stored.filename };
    const doc = await tx.document.create({
      data: {
        tenantId: u.tenantId, legalEntityId: le.id, documentTypeId: typeId, kind: 'VND', title: input.title, status: 'DRAFT',
        data: data as Prisma.InputJsonValue, authorId: u.userId, dueAt: input.dueAt ?? null, pdfFileId,
      },
    });
    const df = await tx.documentFile.create({ data: { documentId: doc.id, name: stored.filename } });
    await tx.fileVersion.create({ data: { documentFileId: df.id, version: 1, storedFileId: stored.id, uploadedById: u.userId } });
    await refreshSearchText(doc.id, tx);
    await audit(u, 'vnd.create', 'Document', doc.id, { title: input.title, file: stored.filename }, { tx });
    return doc.id;
  }, { timeout: 60_000 });
}

// ───────────── Recipients ─────────────

async function departmentSubtree(tx: Tx, tenantId: string, legalEntityId: string, roots: string[]): Promise<string[]> {
  if (!roots.length) return [];
  const rows = await tx.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE tree AS (
      SELECT id FROM "Department" WHERE id = ANY(${roots}) AND "tenantId" = ${tenantId} AND "legalEntityId" = ${legalEntityId}
      UNION
      SELECT d.id FROM "Department" d JOIN tree t ON d."parentId" = t.id
    ) SELECT id FROM tree`;
  return rows.map((r) => r.id);
}

async function notifyRecipients(tx: Tx, doc: { id: string; tenantId: string; title: string; dueAt: Date | null }, userIds: string[]) {
  const due = doc.dueAt ? ` Срок — до ${doc.dueAt.toISOString().slice(0, 10).split('-').reverse().join('.')}.` : '';
  for (const userId of userIds) {
    await notify({
      tenantId: doc.tenantId, userId, type: 'vnd.pending', title: 'Требуется ознакомление с ВНД',
      body: `«${doc.title}». Ознакомьтесь с документом и подтвердите ознакомление подписью.${due}`, link: `/vnd/${doc.id}`,
    }, tx);
  }
}

/** Creates PENDING ACKNOWLEDGE steps for recipients that have none yet (the document must be IN_ROUTE). */
async function createSteps(tx: Tx, doc: { id: string; dueAt: Date | null }, employeeIds: string[]): Promise<string[]> {
  if (!employeeIds.length) return [];
  const emps = await tx.employee.findMany({ where: { id: { in: employeeIds } }, select: { userId: true } });
  const existing = new Set((await tx.routeStep.findMany({ where: { documentId: doc.id, action: 'ACKNOWLEDGE' }, select: { assigneeUserId: true } })).map((s) => s.assigneeUserId));
  const userIds = [...new Set(emps.map((e) => e.userId))].filter((x) => !existing.has(x));
  if (userIds.length) {
    await tx.routeStep.createMany({ data: userIds.map((assigneeUserId) => ({ documentId: doc.id, order: 1, action: 'ACKNOWLEDGE' as const, assigneeUserId, status: 'PENDING' as const, dueAt: doc.dueAt })) });
  }
  return userIds;
}

/**
 * Adds recipients: explicit employees, departments (with all sub-departments) or the whole legal entity.
 * Only ACTIVE employees of the ВНД's legal entity within the user's HR scope; duplicates are skipped.
 * Adding to a sent ВНД notifies the new recipients; adding to a completed one reopens it (IN_ROUTE).
 */
export async function addRecipients(u: UserCtx, docId: string, input: { employeeIds?: string[]; departmentIds?: string[]; allOfLegalEntity?: boolean }) {
  const doc = await getManageableVnd(u, docId);
  return prisma.$transaction(async (tx) => {
    const or: Prisma.EmployeeWhereInput[] = [];
    if (input.allOfLegalEntity) or.push({});
    if (input.employeeIds?.length) or.push({ id: { in: [...new Set(input.employeeIds)] } });
    if (input.departmentIds?.length) {
      const depts = await departmentSubtree(tx, u.tenantId, doc.legalEntityId, [...new Set(input.departmentIds)]);
      if (depts.length) or.push({ departmentId: { in: depts } });
    }
    if (!or.length) return { added: 0 };
    const eligible = await tx.employee.findMany({
      where: { AND: [await managedEmployeeScope(u), { tenantId: u.tenantId, legalEntityId: doc.legalEntityId, status: 'ACTIVE' }, { OR: or }] },
      select: { id: true },
    });
    const ids = eligible.map((e) => e.id);
    const res = ids.length ? await tx.vndRecipient.createMany({ data: ids.map((employeeId) => ({ documentId: doc.id, employeeId })), skipDuplicates: true }) : { count: 0 };
    if (res.count > 0 && doc.status !== 'DRAFT') {
      const fresh = await tx.vndRecipient.findMany({ where: { documentId: doc.id, employeeId: { in: ids }, status: 'PENDING' }, select: { employeeId: true } });
      const userIds = await createSteps(tx, doc, fresh.map((r) => r.employeeId));
      if (doc.status === 'COMPLETED' && userIds.length) {
        await tx.document.update({ where: { id: doc.id }, data: { status: 'IN_ROUTE', completedAt: null, currentStepOrder: 1 } });
      }
      await notifyRecipients(tx, doc, userIds);
    }
    await audit(u, 'vnd.recipients_add', 'Document', doc.id, { added: res.count, departments: input.departmentIds ?? [], all: !!input.allOfLegalEntity }, { tx });
    return { added: res.count };
  }, { timeout: 60_000 });
}

export async function removeRecipient(u: UserCtx, docId: string, recipientId: string) {
  const doc = await getManageableVnd(u, docId);
  await prisma.$transaction(async (tx) => {
    await syncAcknowledgments(tx, { documentId: doc.id });
    const r = await tx.vndRecipient.findFirst({ where: { id: recipientId, documentId: doc.id }, include: { employee: { select: { userId: true } } } });
    if (!r) throw notFound('Recipient');
    if (r.status !== 'PENDING') throw conflict('The recipient has already acknowledged the document', { rule: 'ALREADY_ACKNOWLEDGED' });
    if (doc.status === 'IN_ROUTE') {
      const others = await tx.vndRecipient.count({ where: { documentId: doc.id, id: { not: r.id } } });
      if (others === 0) throw businessRule('LAST_RECIPIENT', 'A sent ВНД must keep at least one recipient');
    }
    await tx.vndRecipient.delete({ where: { id: r.id } });
    await tx.routeStep.deleteMany({ where: { documentId: doc.id, action: 'ACKNOWLEDGE', status: 'PENDING', assigneeUserId: r.employee.userId } });
    await audit(u, 'vnd.recipient_remove', 'Document', doc.id, { employeeId: r.employeeId }, { tx });
    // The removed recipient may have been the last one pending → the ВНД completes.
    if (doc.status === 'IN_ROUTE') await activateNext(tx, doc.id);
  }, { timeout: 60_000 });
}

// ───────────── Send / acknowledge ─────────────

export async function sendVnd(u: UserCtx, docId: string) {
  const doc = await getManageableVnd(u, docId);
  if (doc.status !== 'DRAFT') throw conflict('The ВНД has already been sent', { rule: 'INVALID_STATUS' });
  await prisma.$transaction(async (tx) => {
    const recipients = await tx.vndRecipient.findMany({ where: { documentId: doc.id, employee: { status: 'ACTIVE' } }, select: { employeeId: true } });
    if (!recipients.length) throw businessRule('NO_RECIPIENTS', 'Add at least one recipient before sending');
    await tx.vndRecipient.deleteMany({ where: { documentId: doc.id, employee: { status: { not: 'ACTIVE' } } } });
    const now = new Date();
    await registerNumber(tx, doc.id, { registeredAt: todayUtc() });
    await tx.vndRecipient.updateMany({ where: { documentId: doc.id }, data: { sentAt: now } });
    await tx.document.update({
      where: { id: doc.id },
      data: { status: 'IN_ROUTE', currentStepOrder: 1, data: { ...vndData(doc), sentAt: now.toISOString() } as Prisma.InputJsonValue },
    });
    const userIds = await createSteps(tx, doc, recipients.map((r) => r.employeeId));
    await notifyRecipients(tx, doc, userIds);
    await audit(u, 'vnd.send', 'Document', doc.id, { recipients: recipients.length }, { tx });
  }, { timeout: 120_000 });
}

/**
 * Recipient acknowledgment. With `signingSessionId`: the user's COMPLETED signing session covering this ВНД must have produced
 * their own ACKNOWLEDGE signature (made by /signing/sessions → eGov QR / NCALayer). Without it: a simple CLICK acknowledgment,
 * allowed only when the ВНД was created with requireSignature=false.
 */
export async function acknowledgeVnd(u: UserCtx, docId: string, signingSessionId?: string) {
  const doc = await getReadableVnd(u, docId);
  if (!u.employeeId) throw notFound('Recipient');
  await syncAcknowledgments(prisma, { documentId: doc.id });
  const r = await prisma.vndRecipient.findUnique({ where: { documentId_employeeId: { documentId: doc.id, employeeId: u.employeeId } } });
  if (!r || doc.status === 'DRAFT') throw notFound('Recipient');
  // Confirming a signing session is idempotent: the signature may already have been mirrored (e.g. by the completion hook).
  if (r.status === 'ACKNOWLEDGED' && !signingSessionId) throw conflict('You have already acknowledged this document', { rule: 'ALREADY_ACKNOWLEDGED' });
  if (r.status === 'PENDING' && doc.status !== 'IN_ROUTE') throw conflict('The ВНД is not awaiting acknowledgment', { rule: 'INVALID_STATUS' });

  if (signingSessionId) {
    const session = await prisma.signingSession.findFirst({ where: { id: signingSessionId, userId: u.userId, tenantId: u.tenantId } });
    if (!session || !session.documentIds.includes(doc.id)) throw notFound('Signing session');
    if (session.status !== 'COMPLETED') throw businessRule('SESSION_NOT_COMPLETED', 'Confirm the signature in eGov mobile or NCALayer first');
    const step = await prisma.routeStep.findFirst({
      where: { documentId: doc.id, action: 'ACKNOWLEDGE', assigneeUserId: u.userId, status: 'DONE', signature: { signerUserId: u.userId, onBehalfOfUserId: null } },
    });
    if (!step) throw businessRule('NOT_SIGNED', 'The signing session did not sign this document');
  } else {
    if (vndData(doc).requireSignature !== false) throw businessRule('SIGNATURE_REQUIRED', 'This document must be acknowledged with an electronic signature (ЭЦП)');
    const own = await prisma.routeStep.findFirst({ where: { documentId: doc.id, action: 'ACKNOWLEDGE', assigneeUserId: u.userId, status: 'PENDING' } });
    if (!own) throw businessRule('NOTHING_TO_SIGN', 'You have no pending acknowledgment on this document');
    await inTx((tx) => signAndComplete(tx, { documentId: doc.id, actorUserId: u.userId, method: 'CLICK', actions: ['ACKNOWLEDGE'], principalIds: [] }));
  }
  await prisma.$transaction(async (tx) => {
    await syncAcknowledgments(tx, { documentId: doc.id });
    await audit(u, 'vnd.acknowledge', 'Document', doc.id, { method: signingSessionId ? 'SIGNING_SESSION' : 'CLICK', signingSessionId: signingSessionId ?? null }, { tx });
  });
}
